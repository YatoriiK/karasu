from ..net import NetError
from ..sources.spotify import AuthError
from ..sync import _store_track
from . import media
from .catalog import Catalog
from .home import artist_ids_by_name
from .spotify_lib import image_art, playlist_rows


def _art(images):
    ordered = sorted(images or [], key=lambda i: -(i.get("width") or 0))
    found = image_art(ordered[0].get("url")) if ordered else []
    return found[0] if found else None


def _artists(db, items):
    items = [a for a in items if a and a.get("id")]
    ids = artist_ids_by_name(db, [a.get("name") for a in items])
    return [{"sp_id": a["id"], "name": a.get("name"), "dz_id": ids.get(a.get("name")), "art": _art(a.get("images"))}
            for a in items]


def _saved_top(db, kind):
    return [r["ref"] for r in db.q("select ref from seeds where kind=? order by weight desc limit 20", (kind,))]


def user_profile(ctx):
    db, sp = ctx.db, ctx.sp
    if not (sp.configured and sp.has_login()):
        return {"connected": False}
    saved = db.meta("spotify_user", {}) or {}
    online = True
    try:
        me = sp.me() or {}
    except (NetError, AuthError):
        me, online = {}, False
    user_id = me.get("id") or saved.get("id")
    art = _art(me.get("images"))
    if art:
        art["palette"] = media.palette(ctx, "sp", art["ref"])
    try:
        artists = sp.top("artists", "short_term", max_items=20) if online else []
        tracks = sp.top("tracks", "short_term", max_items=20) if online else []
    except (NetError, AuthError):
        artists, tracks = [], []
    catalog = Catalog(db)
    if tracks:
        with db.tx():
            sp_ids = [_store_track(db, t) for t in tracks]
    else:
        sp_ids = _saved_top(db, "track:top_short_term")
    top_tracks = catalog.tracks(catalog.library_ids([i for i in sp_ids if i]))
    if artists:
        top_artists = _artists(db, artists)
    else:
        rows = {r["id"]: r["name"] for r in db.q("select id, name from sp_artists where id in "
                                                 "(select ref from seeds where kind='artist:top_short_term')")}
        names = [rows[i] for i in _saved_top(db, "artist:top_short_term") if i in rows]
        ids = artist_ids_by_name(db, names)
        known = {a["dz_id"]: a for a in catalog.artists(list(ids.values()))}
        top_artists = [{"sp_id": None, "name": n, "dz_id": ids.get(n), "art": (known.get(ids.get(n)) or {}).get("art")}
                       for n in names]
    granted = "user-follow-read" in sp.granted_scopes()
    following = {"granted": granted, "available": granted and online, "total": None, "artists": []}
    if following["available"]:
        try:
            block = sp.following()
            following["artists"] = _artists(db, block.get("items") or [])
            following["total"] = block.get("total", len(following["artists"]))
        except (NetError, AuthError):
            following["available"] = False
    lists = [p for p in playlist_rows(ctx) if p.get("own") and p.get("public")]
    return {
        "connected": True,
        "online": online,
        "user": {
            "id": user_id,
            "name": me.get("display_name") or saved.get("name") or user_id,
            "art": art,
            "followers": (me.get("followers") or {}).get("total"),
            "product": me.get("product"),
            "url": (me.get("external_urls") or {}).get("spotify")
            or (f"https://open.spotify.com/user/{user_id}" if user_id else None),
        },
        "playlists": lists,
        "top_artists": top_artists,
        "top_tracks": top_tracks,
        "following": following,
        "since": db.one("select min(played_at) from listen_events")[0],
    }
