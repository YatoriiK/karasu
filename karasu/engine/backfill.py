import json
import re

from ..audio import model_name, process_tracks, shared_clap, shared_pool
from ..net import NetError
from ..resolve import seed_to_deezer
from ..util import norm_artist, now_iso
from . import facets as F
from .media import forget_placeholders

ARTIST_MD5 = re.compile(r"/images/artist/([0-9a-f]{32})/")
COVER_MD5 = re.compile(r"/images/cover/([0-9a-f]{32})/")


def _walk(node, tracks, artists, albums):
    if isinstance(node, list):
        for item in node:
            _walk(item, tracks, artists, albums)
        return
    if not isinstance(node, dict):
        return
    kind = node.get("type")
    if kind == "track" and node.get("id"):
        md5 = node.get("md5_image") or (node.get("album") or {}).get("md5_image")
        if not md5:
            m = COVER_MD5.search(str((node.get("album") or {}).get("cover_small") or ""))
            md5 = m.group(1) if m else None
        tracks[node["id"]] = (md5, node.get("bpm") or None, node.get("gain"))
    elif kind == "artist" and node.get("id"):
        m = ARTIST_MD5.search(str(node.get("picture_small") or node.get("picture") or ""))
        if m:
            artists[node["id"]] = m.group(1)
    elif kind == "album" and node.get("id"):
        md5 = node.get("md5_image")
        if not md5:
            m = COVER_MD5.search(str(node.get("cover_small") or ""))
            md5 = m.group(1) if m else None
        if md5:
            albums[node["id"]] = md5
    for value in node.values():
        if isinstance(value, (dict, list)):
            _walk(value, tracks, artists, albums)


def art_from_cache(jc):
    cache = jc.ctx.net.cache
    with cache.lock:
        rows = cache.conn.execute("select body from cache where host='api.deezer.com' and status=200").fetchall()
    tracks, artists, albums = {}, {}, {}
    for n, (body,) in enumerate(rows, 1):
        try:
            _walk(json.loads(body), tracks, artists, albums)
        except ValueError:
            continue
        if n % 500 == 0:
            jc.progress("Recovering artwork", n, len(rows))
    db = jc.ctx.db
    with db.tx():
        for tid, (md5, bpm, gain) in tracks.items():
            db.x("update dz_tracks set md5=coalesce(md5, ?), bpm=coalesce(bpm, ?), gain=coalesce(gain, ?) where id=?",
                 (md5, bpm, gain, tid))
        for album_id, md5 in albums.items():
            db.x("update dz_tracks set md5=coalesce(md5, ?) where album_id=?", (md5, album_id))
        for aid, md5 in artists.items():
            db.x("update dz_artists set picture=coalesce(picture, ?) where id=?", (md5, aid))
    return {"tracks": len(tracks), "artists": len(artists), "albums": len(albums)}


def library_rows(db):
    return db.q(
        "select * from sp_tracks where id in (select ref from seeds where kind like 'track:%' "
        "union select track_id from saved union select track_id from plays union select track_id from playlist_tracks)")


def library_map(jc):
    db = jc.ctx.db
    rows = [r for r in library_rows(db) if not db.one("select 1 from sp_dz where sp_id=?", (r["id"],))]
    for n, row in enumerate(rows, 1):
        try:
            seed_to_deezer(jc.ctx, row)
        except NetError:
            pass
        jc.progress("Matching your library", n, len(rows))
    return {"matched": len(rows)}


def embed_library(jc):
    db = jc.ctx.db
    name = model_name(jc.ctx.cfg)
    ids = [r[0] for r in db.q(
        "select s.dz_id from sp_dz s where s.dz_id > 0 and s.dz_id not in (select dz_id from embeddings where model=?)",
        (name,))]
    if not ids:
        return {"embedded": 0}
    with jc.gpu():
        done = process_tracks(jc.ctx, [(i, None) for i in ids], clap=shared_clap(jc.ctx.cfg),
                              pool=shared_pool(jc.ctx.cfg),
                              progress=lambda d, t: jc.progress("Listening to your library", d, t),
                              cancelled=lambda: jc.cancelled)
    return {"embedded": done}


def dsp_backfill(jc, limit=None):
    db = jc.ctx.db
    ids = [r[0] for r in db.q("select dz_id from embeddings where dz_id not in (select dz_id from dsp)")]
    if limit:
        ids = ids[:limit]
    if not ids:
        return {"analyzed": 0}
    done = process_tracks(jc.ctx, [(i, None) for i in ids], want_clap=False, want_dsp=True,
                          pool=shared_pool(jc.ctx.cfg),
                          progress=lambda d, t: jc.progress("Measuring tempo and energy", d, t),
                          cancelled=lambda: jc.cancelled)
    return {"analyzed": done}


def facets_backfill(jc):
    with jc.gpu():
        jc.progress("Describing every sound", 0, 1, force=True)
        count = F.compute_all(jc.ctx, shared_clap(jc.ctx.cfg),
                              progress=lambda d, t: jc.progress("Describing every sound", d, t))
    return {"tracks": count}


def artist_tags(jc, budget=150):
    db = jc.ctx.db
    rows = db.q(
        "select a.name, a.norm, sum(s.weight) w from sp_artists a left join seeds s on s.ref = a.id "
        "where a.norm not in (select norm from artist_tags) group by a.norm order by w desc nulls last limit ?",
        (budget,))
    done = 0
    for n, row in enumerate(rows, 1):
        try:
            found = jc.ctx.mb.search_artist(row["name"], limit=3)
        except NetError:
            found = []
        match = next((a for a in found if norm_artist(a.get("name")) == row["norm"]
                      and int(a.get("score") or 0) >= 90), None)
        tags = {}
        if match:
            for t in match.get("tags") or []:
                if t.get("name") and (t.get("count") or 0) > 0:
                    tags[t["name"].strip().lower()] = t["count"]
        db.x("insert or replace into artist_tags(norm, tags, source, checked_at) values(?,?,?,?)",
             (row["norm"], json.dumps(tags), "musicbrainz", now_iso()))
        done += 1
        jc.progress("Learning your genres", n, len(rows))
    return {"artists": done}


def rebuild_search_index(jc=None, db=None):
    db = db or jc.ctx.db
    with db.tx():
        db.x("delete from search_index")
        db.x("insert into search_index(kind, ref, title, artist, album) "
             "select 'track', 'dz:' || id, title, artist, album from dz_tracks")
        db.x("insert into search_index(kind, ref, title, artist, album) "
             "select 'track', 'sp:' || id, name, json_extract(artists, '$[0]'), album from sp_tracks "
             "where id not in (select sp_id from sp_dz where dz_id > 0)")
        db.x("insert into search_index(kind, ref, title, artist, album) "
             "select 'artist', id, name, name, '' from dz_artists where name is not null")
        db.x("insert into search_index(kind, ref, title, artist, album) "
             "select 'album', album_id, album, min(artist), album from dz_tracks "
             "where album_id is not null and album is not null group by album_id")
    count = db.one("select count(*) from search_index")[0]
    db.set_meta("search_index_stamp", count)
    return {"indexed": count}


def blank_covers(jc):
    return forget_placeholders(jc.ctx.db)


def genres_backfill(jc):
    from .corpus import Corpus
    from .genres import refresh
    corpus = Corpus(jc.ctx)
    corpus.refresh(force=True)
    return refresh(jc, corpus, retrain=True)


def events_from_plays(jc):
    db = jc.ctx.db
    with db.tx():
        cur = db.x(
            "insert or ignore into listen_events(source, sp_id, dz_id, artist, title, played_at, ms_played, skipped) "
            "select 'spotify', p.track_id, null, json_extract(t.artists, '$[0]'), t.name, p.played_at, t.duration_ms, 0 "
            "from plays p join sp_tracks t on t.id = p.track_id")
    return {"events": cur.rowcount}


STEPS = [
    ("events", "Indexing your plays", events_from_plays),
    ("art", "Recovering artwork", art_from_cache),
    ("map", "Matching your library", library_map),
    ("embed", "Listening to your library", embed_library),
    ("facets", "Describing every sound", facets_backfill),
    ("index", "Building search", rebuild_search_index),
    ("dsp", "Measuring tempo and energy", dsp_backfill),
    ("tags", "Learning your genres", artist_tags),
    ("covers", "Fixing missing covers", blank_covers),
    ("genres", "Learning genres", genres_backfill),
]


def first_run(jc, steps=None):
    done = set(jc.ctx.db.meta("backfill_steps", []))
    results = {}
    for key, label, fn in STEPS:
        if steps and key not in steps:
            continue
        if key in done and not steps:
            continue
        jc.progress(label, 0, 0, force=True)
        results[key] = fn(jc)
        done.add(key)
        jc.ctx.db.set_meta("backfill_steps", sorted(done))
    return results
