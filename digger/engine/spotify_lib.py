from urllib.parse import urlsplit

from ..net import NetError
from ..sources.spotify import entry_track
from ..sync import _store_track
from ..util import now_iso, parse_iso
from .catalog import Catalog


def image_art(url):
    if not url:
        return []
    parts = urlsplit(url)
    if parts.hostname == "mosaic.scdn.co":
        tail = parts.path.rstrip("/").rsplit("/", 1)[-1]
        ids = [tail[i:i + 40] for i in range(0, len(tail), 40) if len(tail[i:i + 40]) == 40]
        return [{"kind": "sp", "ref": i, "src": f"/api/art/sp/{i}?s=320", "palette": None} for i in ids[:4]]
    if "/image/" in parts.path:
        ref = parts.path.rsplit("/", 1)[-1]
        if ref.isalnum():
            return [{"kind": "sp", "ref": ref, "src": f"/api/art/sp/{ref}?s=320", "palette": None}]
    return []


def _total(pl):
    for key in ("items", "tracks"):
        value = pl.get(key)
        if isinstance(value, dict) and value.get("total") is not None:
            return value.get("total")
    return None


def refresh_playlists(ctx, with_items=True):
    db = ctx.db
    me = db.meta("spotify_user", {}) or {}
    user_id = me.get("id")
    lists = ctx.sp.playlists()
    queue = db.meta("sp_queue_playlist", None)
    stamp = now_iso()
    seen = []
    with db.tx():
        for pos, pl in enumerate(lists):
            if not isinstance(pl, dict) or not pl.get("id") or pl["id"] == queue:
                continue
            images = pl.get("images") or []
            owner = pl.get("owner") or {}
            db.x(
                "insert into sp_playlists(id, name, description, owner_id, owner_name, image, total, snapshot_id, "
                "collaborative, public, pos, synced_at) values(?,?,?,?,?,?,?,?,?,?,?,?) "
                "on conflict(id) do update set name=excluded.name, description=excluded.description, "
                "owner_id=excluded.owner_id, owner_name=excluded.owner_name, image=excluded.image, "
                "total=excluded.total, snapshot_id=excluded.snapshot_id, collaborative=excluded.collaborative, "
                "public=excluded.public, pos=excluded.pos, synced_at=excluded.synced_at",
                (pl["id"], pl.get("name") or "Untitled", pl.get("description") or "", owner.get("id"),
                 owner.get("display_name") or owner.get("id"), images[0].get("url") if images else None,
                 _total(pl), pl.get("snapshot_id"), int(bool(pl.get("collaborative"))),
                 int(bool(pl.get("public"))), pos, stamp))
            seen.append(pl["id"])
        if seen:
            marks = ",".join("?" * len(seen))
            db.x(f"delete from sp_playlist_items where playlist_id not in ({marks})", seen)
            db.x(f"delete from sp_playlists where id not in ({marks})", seen)
    db.set_meta("sp_playlists_synced", stamp)
    loaded = 0
    if with_items:
        for row in db.q("select id, snapshot_id, items_snapshot, owner_id, collaborative from sp_playlists"):
            mine = row["owner_id"] == user_id or row["collaborative"]
            if mine and row["snapshot_id"] != row["items_snapshot"]:
                try:
                    load_items(ctx, row["id"])
                    loaded += 1
                except NetError:
                    continue
    return {"playlists": len(seen), "loaded": loaded}


def load_items(ctx, playlist_id):
    db = ctx.db
    entries = ctx.sp.playlist_items(playlist_id)
    snap = db.one("select snapshot_id from sp_playlists where id=?", (playlist_id,))
    with db.tx():
        db.x("delete from sp_playlist_items where playlist_id=?", (playlist_id,))
        pos = 0
        for entry in entries:
            tid = _store_track(db, entry_track(entry))
            if not tid:
                continue
            db.x("insert into sp_playlist_items(playlist_id, pos, track_id, added_at) values(?,?,?,?)",
                 (playlist_id, pos, tid, entry.get("added_at")))
            pos += 1
        db.x("update sp_playlists set items_snapshot=?, items_at=?, total=? where id=?",
             (snap[0] if snap else None, now_iso(), pos, playlist_id))
    return pos


def sync_liked(ctx):
    db = ctx.db
    entries = ctx.sp.saved_tracks()
    ids = []
    with db.tx():
        for entry in entries:
            tid = _store_track(db, entry_track(entry))
            if tid:
                ids.append(tid)
                db.x("insert or replace into saved(track_id, added_at) values(?,?)", (tid, entry.get("added_at")))
        if ids:
            marks = ",".join("?" * len(ids))
            removed = db.x(f"delete from saved where track_id not in ({marks})", ids).rowcount
        else:
            removed = 0
    db.set_meta("liked_synced", now_iso())
    return {"liked": len(ids), "removed": removed}


def stale(db, key, minutes):
    stamp = parse_iso(db.meta(key))
    if not stamp:
        return True
    from ..util import now
    return (now() - stamp).total_seconds() > minutes * 60


def playlist_rows(ctx):
    db = ctx.db
    me = db.meta("spotify_user", {}) or {}
    lanes = {r["sp_id"]: r["lane"] for r in db.q("select lane, sp_id from playlists where sp_id is not null")}
    out = []
    rows = db.q("select * from sp_playlists where id is not ? order by pos", (db.meta("sp_queue_playlist", None),))
    firsts = {}
    for r in db.q("select playlist_id, track_id from sp_playlist_items where pos < 4 order by playlist_id, pos"):
        firsts.setdefault(r["playlist_id"], []).append(r["track_id"])
    images = {r["id"]: r["image"] for r in
              db.q("select id, image from sp_tracks where id in (select track_id from sp_playlist_items where pos < 4)")}
    for r in rows:
        art = image_art(r["image"])
        if not art:
            art = [{"kind": "sp", "ref": u.rsplit("/", 1)[-1], "src": f"/api/art/sp/{u.rsplit('/', 1)[-1]}?s=320",
                    "palette": None} for u in (images.get(t) for t in firsts.get(r["id"], [])) if u and "/image/" in u]
        lane = lanes.get(r["id"])
        out.append({
            "id": f"lane:{lane}" if lane else f"sp:{r['id']}",
            "kind": "spotify",
            "sp_id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "owner": r["owner_name"],
            "own": r["owner_id"] == me.get("id"),
            "public": bool(r["public"]),
            "editable": bool(r["owner_id"] == me.get("id") or r["collaborative"]),
            "count": r["total"] or 0,
            "art": art,
            "track_ids": [],
        })
    return out


def playlist_detail(ctx, sp_id):
    db = ctx.db
    row = db.one("select * from sp_playlists where id=?", (sp_id,))
    me = db.meta("spotify_user", {}) or {}
    if row is None:
        try:
            data = ctx.sp.playlist(sp_id) or {}
        except NetError:
            data = {}
        if not data.get("id"):
            return None
        images = data.get("images") or []
        owner = data.get("owner") or {}
        db.x("insert or replace into sp_playlists(id, name, description, owner_id, owner_name, image, total, "
             "snapshot_id, collaborative, public, pos, synced_at) values(?,?,?,?,?,?,?,?,?,?,?,?)",
             (data["id"], data.get("name") or "Untitled", data.get("description") or "", owner.get("id"),
              owner.get("display_name") or owner.get("id"), images[0].get("url") if images else None, _total(data),
              data.get("snapshot_id"), int(bool(data.get("collaborative"))), int(bool(data.get("public"))), 9999,
              now_iso()))
        row = db.one("select * from sp_playlists where id=?", (sp_id,))
    blocked = False
    if row["items_snapshot"] != row["snapshot_id"] or row["items_at"] is None:
        try:
            load_items(ctx, sp_id)
            row = db.one("select * from sp_playlists where id=?", (sp_id,))
        except NetError as exc:
            blocked = exc.status in (401, 403, 404)
            if not blocked:
                raise
    ids = [r[0] for r in db.q("select track_id from sp_playlist_items where playlist_id=? order by pos", (sp_id,))]
    catalog = Catalog(db)
    tracks = catalog.tracks(catalog.library_ids(ids))
    return {
        "id": f"sp:{sp_id}",
        "kind": "spotify",
        "sp_id": sp_id,
        "name": row["name"],
        "description": _clean(row["description"]),
        "owner": row["owner_name"],
        "editable": bool(row["owner_id"] == me.get("id") or row["collaborative"]),
        "blocked": blocked,
        "art": image_art(row["image"]),
        "tracks": tracks,
    }


def _clean(text):
    import html
    import re
    return re.sub(r"<[^>]+>", "", html.unescape(text or "")).strip()


def add_tracks(ctx, sp_id, sp_track_ids):
    uris = [f"spotify:track:{t}" for t in sp_track_ids]
    result = ctx.sp.add_items(sp_id, uris) or {}
    _after_edit(ctx, sp_id, result.get("snapshot_id"))
    return len(uris)


def remove_tracks(ctx, sp_id, sp_track_ids):
    uris = [f"spotify:track:{t}" for t in sp_track_ids]
    result = ctx.sp.remove_items(sp_id, uris) or {}
    _after_edit(ctx, sp_id, result.get("snapshot_id"))
    return len(uris)


def _after_edit(ctx, sp_id, snapshot):
    if snapshot:
        ctx.db.x("update sp_playlists set snapshot_id=? where id=?", (snapshot, sp_id))
    try:
        load_items(ctx, sp_id)
    except NetError:
        pass


def create_playlist(ctx, name, description, sp_track_ids):
    created = ctx.sp.create_playlist(name, description or "Made with Karasu", False) or {}
    sp_id = created.get("id")
    if not sp_id:
        raise NetError("Spotify didn't create the playlist")
    if sp_track_ids:
        ctx.sp.add_items(sp_id, [f"spotify:track:{t}" for t in sp_track_ids])
    try:
        refresh_playlists(ctx, with_items=False)
        load_items(ctx, sp_id)
    except NetError:
        pass
    return sp_id

