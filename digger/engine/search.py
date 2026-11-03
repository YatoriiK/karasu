import math
import re
from concurrent.futures import ThreadPoolExecutor, wait

from ..net import NetError
from ..resolve import store_dz_track
from ..util import fold, norm_artist, now_iso, track_key
from .catalog import Catalog, art_payload, tier
from .media import bare_title, cached_palettes

_TOKEN = re.compile(r"[\w']+", re.U)
_PUNCT = re.compile(r"[^\w\s]", re.U)
_REMOTE = ThreadPoolExecutor(3, thread_name_prefix="live-search")
REMOTE_WAIT = 1.2
CAPS = {"artist": 3, "track": 4, "album": 3}
ORDER = {"artist": 0, "track": 1, "album": 2}


def fts_query(text):
    tokens = [t.replace("'", "") for t in _TOKEN.findall(text.lower()) if t.strip("'")]
    if not tokens:
        return None
    return " AND ".join(f'"{t}"*' for t in tokens[:8])


def suggest(db, text, limit=6):
    query = fts_query(text)
    out = {"tracks": [], "artists": [], "albums": [], "recent": []}
    prefix = text.strip().lower()
    out["recent"] = [r[0] for r in db.q("select q from search_history where q like ? order by last_at desc limit 4",
                                        (prefix + "%",))] if prefix else \
        [r[0] for r in db.q("select q from search_history order by last_at desc limit 6")]
    if not query:
        return out
    rows = db.q("select kind, ref, title, artist, album from search_index where search_index match ? "
                "order by bm25(search_index, 0, 0, 3.0, 2.0, 1.0) limit 60", (query,))
    track_ids, artists, albums = [], {}, {}
    for r in rows:
        if r["kind"] == "track" and len(track_ids) < limit:
            track_ids.append(r["ref"])
        elif r["kind"] == "artist" and len(artists) < 4:
            artists.setdefault(norm_artist(r["title"]), int(r["ref"]))
        elif r["kind"] == "album" and len(albums) < 4:
            albums.setdefault(int(r["ref"]), (r["title"], r["artist"]))
    catalog = Catalog(db)
    out["tracks"] = catalog.tracks(track_ids)
    out["artists"] = catalog.artists(list(artists.values()))
    covers = {}
    for album_id in albums:
        row = db.one("select md5 from dz_tracks where album_id=? and md5 is not null limit 1", (album_id,))
        covers[album_id] = row[0] if row else None
    palettes = cached_palettes(db, [f"cover:{m}" for m in covers.values() if m])
    out["albums"] = [{"dz_id": a, "title": t, "artist": ar,
                      "art": art_payload(("cover", covers[a]), palettes) if covers.get(a) else None}
                     for a, (t, ar) in albums.items()]
    return out


def _plain(text):
    return " ".join(_PUNCT.sub(" ", fold(text)).split())


def match_score(name, text):
    n, t = _plain(name), _plain(text)
    if not n or not t:
        return 0.0
    if n == t:
        return 3.0
    if n.startswith(t):
        return 2.0 + 0.5 * len(t) / len(n)
    if f" {t}" in f" {n}":
        return 1.5
    return 1.0 if t in n else 0.0


def _track_score(t, text):
    artist = t["artist"]["name"] or ""
    title = bare_title(t["title"])
    return max(match_score(title, text), 0.9 * match_score(f"{artist} {title}", text), 0.6 * match_score(artist, text))


def _album_score(al, text):
    title = bare_title(al["title"])
    artist = al.get("artist") or ""
    return max(match_score(title, text), 0.9 * match_score(f"{artist} {title}", text), 0.5 * match_score(artist, text))


def _remote(ctx, text):
    jobs = {kind: _REMOTE.submit(ctx.dz.search, kind, text, limit, 0, 3 * 86400)
            for kind, limit in (("artist", 4), ("track", 8), ("album", 4))}
    done, _ = wait(jobs.values(), timeout=REMOTE_WAIT)
    out = {}
    for kind, job in jobs.items():
        try:
            out[kind] = (job.result(timeout=0) or []) if job in done else None
        except Exception:
            out[kind] = []
    return out


def _in(db, sql, ids):
    ids = list(ids)
    return db.q(sql.format(marks=",".join("?" * len(ids))), ids) if ids else []


def _signals(db, found):
    tracks = {r["id"]: (r["rank"], r["mine"]) for r in _in(
        db, "select id, coalesce(rank, 0) rank, exists(select 1 from sp_dz x where x.dz_id=t.id) mine "
            "from dz_tracks t where id in ({marks})", {t["dz_id"] for t, _ in found["track"] if t.get("dz_id")})}
    artists = {r[0] for r in _in(
        db, "select distinct artist_id from dz_tracks t join sp_dz x on x.dz_id=t.id where artist_id in ({marks})",
        {a["dz_id"] for a, _ in found["artist"]})}
    albums = {r[0] for r in _in(
        db, "select distinct album_id from dz_tracks t join sp_dz x on x.dz_id=t.id where album_id in ({marks})",
        {al["dz_id"] for al, _ in found["album"]})}
    return tracks, artists, albums


def _top_titles(db, artist_id):
    rows = db.q("select title from dz_tracks t where artist_id=? order by "
                "exists(select 1 from sp_dz x where x.dz_id=t.id) desc, coalesce(rank, 0) desc limit 6", (artist_id,))
    return list(dict.fromkeys(bare_title(r[0]) for r in rows))[:2]


def completions(db, text, items, recent, limit=4):
    want = _plain(text)
    out, seen = [], set()

    def add(value):
        value = " ".join((value or "").lower().split())
        key = _plain(value)
        if key and key.startswith(want) and key not in seen:
            seen.add(key)
            out.append(value)

    for r in recent[:2]:
        add(r)
    for entry in items:
        kind, item = entry["kind"], entry["item"]
        if kind == "artist":
            add(item["name"])
            for title in _top_titles(db, item["dz_id"]):
                add(f"{item['name']} {title}")
            continue
        artist = item["artist"]["name"] if kind == "track" else item["artist"]
        title = bare_title(item["title"])
        if _plain(title) != _plain(artist):
            add(f"{artist} {title}")
        add(title)
        if len(out) >= limit:
            break
    return out[:limit]


def live(ctx, text, remote=False):
    db = ctx.db
    text = text.strip()
    local = suggest(db, text, limit=30)
    out = {"query": text, "recent": local["recent"], "queries": [], "items": [], "partial": False}
    if not fts_query(text):
        return out
    found = {"artist": [(a, True) for a in local["artists"]], "track": [(t, True) for t in local["tracks"]],
             "album": [(al, True) for al in local["albums"]]}
    if remote and len(text) >= 2:
        hits = _remote(ctx, text)
        out["partial"] = any(v is None for v in hits.values())
        catalog = Catalog(db)
        for a in hits["artist"] or []:
            if a.get("id"):
                _store_artist(db, a)
        found["artist"] += [(a, False) for a in catalog.artists([a["id"] for a in hits["artist"] or [] if a.get("id")])]
        ids = []
        for t in hits["track"] or []:
            if t.get("id"):
                store_dz_track(db, t)
                ids.append(f"dz:{t['id']}")
        found["track"] += [(t, False) for t in catalog.tracks(ids)]
        albums = [a for a in hits["album"] or [] if a.get("id")]
        palettes = cached_palettes(db, [f"cover:{a['md5_image']}" for a in albums if a.get("md5_image")])
        found["album"] += [({"dz_id": a["id"], "title": a.get("title"), "artist": (a.get("artist") or {}).get("name"),
                             "art": art_payload(("cover", a["md5_image"]), palettes) if a.get("md5_image") else None,
                             "tracks": a.get("nb_tracks")}, False) for a in albums]
    ranks, my_artists, my_albums = _signals(db, found)
    ranked = []
    for kind, entries in found.items():
        seen, scored = set(), []
        for item, mine in entries:
            if kind == "artist":
                key = item["dz_id"]
                score = (match_score(item["name"], text) + min(math.log10((item.get("fans") or 0) + 1) / 6, 1) * 0.4
                         + 0.3 * (key in my_artists))
            elif kind == "track":
                key = track_key(item["artist"]["name"], item["title"])
                rank, saved = ranks.get(item["dz_id"], (0, item["dz_id"] is None))
                liked = item["state"]["liked"] or item["state"]["saved"]
                score = _track_score(item, text) + 0.25 * min(rank / 800000, 1) + 0.3 * bool(saved) + 0.2 * liked
            else:
                key = (_plain(item.get("artist")), _plain(bare_title(item["title"])))
                score = _album_score(item, text) + 0.3 * (item["dz_id"] in my_albums)
            if key in seen or score <= 0:
                continue
            seen.add(key)
            scored.append({"kind": kind, "score": round(score + 0.4 * mine, 3), "item": item})
        scored.sort(key=lambda e: -e["score"])
        if kind == "artist":
            names = set()
            for e in scored:
                name = _plain(e["item"]["name"])
                if name in names:
                    e["score"] = round(e["score"] - 1.0, 3)
                names.add(name)
            scored.sort(key=lambda e: -e["score"])
        ranked += scored[:CAPS[kind]]
    ranked.sort(key=lambda e: (-e["score"], ORDER[e["kind"]]))
    out["items"] = ranked[:8]
    out["queries"] = completions(db, text, out["items"], local["recent"])
    return out


def record(db, text):
    text = text.strip()
    if not text:
        return
    db.x("insert into search_history(q, last_at, count) values(?,?,1) "
         "on conflict(q) do update set last_at=excluded.last_at, count=count+1", (text[:120], now_iso()))


def _store_artist(db, a):
    import re as _re
    md5 = None
    m = _re.search(r"/images/artist/([0-9a-f]{32})/", str(a.get("picture_small") or ""))
    if m:
        md5 = m.group(1)
    db.x("insert into dz_artists(id, name, norm, fans, nb_album, picture) values(?,?,?,?,?,?) "
         "on conflict(id) do update set fans=coalesce(excluded.fans, dz_artists.fans), "
         "picture=coalesce(dz_artists.picture, excluded.picture), name=excluded.name",
         (a["id"], a.get("name"), norm_artist(a.get("name")), a.get("nb_fan"), a.get("nb_album"), md5))


def full(ctx, text):
    db = ctx.db
    record(db, text)
    local = suggest(db, text, limit=10)
    remote_tracks, remote_artists, remote_albums = [], [], []
    try:
        for t in ctx.dz.search("track", text, limit=20, ttl=3 * 86400):
            if t.get("id"):
                store_dz_track(db, t)
                remote_tracks.append(f"dz:{t['id']}")
        for a in ctx.dz.search("artist", text, limit=8, ttl=3 * 86400):
            if a.get("id"):
                _store_artist(db, a)
                remote_artists.append(a["id"])
        for al in ctx.dz.search("album", text, limit=8, ttl=3 * 86400):
            if al.get("id"):
                remote_albums.append(al)
    except NetError:
        pass
    catalog = Catalog(db)
    seen = {t["id"] for t in local["tracks"]}
    tracks = local["tracks"] + [t for t in catalog.tracks(remote_tracks) if t["id"] not in seen]
    seen_a = {a["dz_id"] for a in local["artists"]}
    artists = local["artists"] + [a for a in catalog.artists(remote_artists) if a["dz_id"] not in seen_a]
    seen_al = {a["dz_id"] for a in local["albums"]}
    palettes = cached_palettes(db, [f"cover:{a.get('md5_image')}" for a in remote_albums if a.get("md5_image")])
    albums = local["albums"] + [
        {"dz_id": a["id"], "title": a.get("title"), "artist": (a.get("artist") or {}).get("name"),
         "art": art_payload(("cover", a["md5_image"]), palettes) if a.get("md5_image") else None,
         "tracks": a.get("nb_tracks")}
        for a in remote_albums if a["id"] not in seen_al]
    top = None
    if artists and norm_artist(artists[0]["name"]) == norm_artist(text):
        top = {"kind": "artist", "item": artists[0]}
    elif tracks:
        top = {"kind": "track", "item": tracks[0]}
    return {"query": text, "top": top, "tracks": tracks[:30], "artists": artists[:12], "albums": albums[:12],
            "tiers": {a["dz_id"]: tier(a.get("fans")) for a in artists}}
