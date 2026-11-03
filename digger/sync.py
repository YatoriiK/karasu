import json
import math
import zipfile

from .util import norm_artist, now_iso, parse_iso, track_key
from .sources.spotify import entry_track

TOP_WEIGHTS = {"short_term": 3.0, "medium_term": 2.0, "long_term": 1.5}


def _store_track(db, track):
    if not track or not track.get("id") or track.get("type", "track") != "track":
        return None
    artists = track.get("artists") or []
    album = track.get("album") or {}
    name = track.get("name") or ""
    first = artists[0]["name"] if artists else ""
    images = sorted(album.get("images") or [], key=lambda i: -(i.get("width") or 0))
    image = images[0]["url"] if images else None
    db.x(
        "insert or replace into sp_tracks(id, name, artists, artist_ids, album, album_type, release_date, isrc, "
        "duration_ms, key, image) values(?,?,?,?,?,?,?,?,?,?,?)",
        (
            track["id"], name, json.dumps([a.get("name") for a in artists]),
            json.dumps([a.get("id") for a in artists]), album.get("name"), album.get("album_type"),
            album.get("release_date"), (track.get("external_ids") or {}).get("isrc"),
            track.get("duration_ms"), track_key(first, name), image,
        ),
    )
    for artist in artists:
        if artist.get("id"):
            db.x(
                "insert into sp_artists(id, name, norm) values(?,?,?) on conflict(id) do update set name=excluded.name",
                (artist["id"], artist.get("name"), norm_artist(artist.get("name"))),
            )
    return track["id"]


def _seed(db, kind, ref, weight):
    db.x(
        "insert into seeds(kind, ref, weight) values(?,?,?) "
        "on conflict(kind, ref) do update set weight=max(weight, excluded.weight)",
        (kind, ref, weight),
    )


def sync_all(sp, db, log=print):
    me = sp.me() or {}
    db.set_meta("spotify_user", {"id": me.get("id"), "name": me.get("display_name"), "product": me.get("product")})
    with db.tx():
        db.x("delete from seeds where kind like 'track:top_%' or kind like 'artist:top_%'")
    counts = {}
    for time_range, base in TOP_WEIGHTS.items():
        tracks = sp.top("tracks", time_range)
        with db.tx():
            for rank, track in enumerate(tracks):
                tid = _store_track(db, track)
                if tid:
                    _seed(db, f"track:top_{time_range}", tid, base * (1 - 0.5 * rank / max(1, len(tracks))))
        artists = sp.top("artists", time_range)
        with db.tx():
            for rank, artist in enumerate(artists):
                if not artist.get("id"):
                    continue
                db.x(
                    "insert or replace into sp_artists(id, name, norm, genres) values(?,?,?,?)",
                    (artist["id"], artist.get("name"), norm_artist(artist.get("name")),
                     json.dumps(artist.get("genres") or [])),
                )
                _seed(db, f"artist:top_{time_range}", artist["id"], base * (1 - 0.5 * rank / max(1, len(artists))))
        counts[f"top_{time_range}"] = (len(tracks), len(artists))
        log(f"  top {time_range}: {len(tracks)} tracks, {len(artists)} artists")
    saved = sp.saved_tracks()
    with db.tx():
        for entry in saved:
            track = entry_track(entry)
            tid = _store_track(db, track)
            if not tid:
                continue
            db.x("insert or replace into saved(track_id, added_at) values(?,?)", (tid, entry.get("added_at")))
            age = (parse_iso(now_iso()) - (parse_iso(entry.get("added_at")) or parse_iso(now_iso()))).days
            _seed(db, "track:saved", tid, max(0.25, math.exp(-age / 365)))
    counts["saved"] = len(saved)
    log(f"  saved tracks: {len(saved)}")
    counts["recent"] = snapshot_recent(sp, db)
    log(f"  recently played (new): {counts['recent']}")
    user_id = me.get("id")
    own = []
    for pl in sp.playlists():
        owner = (pl.get("owner") or {}).get("id")
        if owner == user_id or pl.get("collaborative"):
            own.append(pl)
    managed = {row["sp_id"] for row in db.q("select sp_id from playlists")}
    own = [pl for pl in own if pl["id"] not in managed]
    total = 0
    for pl in own:
        entries = sp.playlist_items(pl["id"])
        with db.tx():
            db.x("delete from playlist_tracks where playlist_id=?", (pl["id"],))
            for entry in entries:
                tid = _store_track(db, entry_track(entry))
                if tid:
                    db.x("insert or ignore into playlist_tracks(playlist_id, track_id) values(?,?)", (pl["id"], tid))
                    _seed(db, "track:playlist", tid, 0.5)
                    total += 1
    counts["playlist_tracks"] = total
    log(f"  own playlists: {len(own)}, {total} tracks")
    db.set_meta("last_sync", now_iso())
    return counts


def snapshot_recent(sp, db):
    last = db.meta("recent_cursor")
    items = sp.recently_played(after_ms=last)
    newest = last or 0
    added = 0
    with db.tx():
        for item in items:
            track = entry_track(item)
            tid = _store_track(db, track)
            played_at = item.get("played_at")
            if not tid or not played_at:
                continue
            cur = db.x("insert or ignore into plays(track_id, played_at) values(?,?)", (tid, played_at))
            added += cur.rowcount
            names = [a.get("name") for a in track.get("artists") or []]
            db.x(
                "insert or ignore into listen_events(source, sp_id, dz_id, artist, title, played_at, ms_played, skipped) "
                "values('spotify', ?, null, ?, ?, ?, ?, 0)",
                (tid, names[0] if names else None, track.get("name"), played_at, track.get("duration_ms")),
            )
            _seed(db, "track:recent", tid, 0.6)
            ms = int(parse_iso(played_at).timestamp() * 1000)
            newest = max(newest, ms)
    if newest:
        db.set_meta("recent_cursor", newest)
    return added


def snapshot_saved(sp, db, pages=2):
    saved = sp.saved_tracks(max_items=50 * pages)
    with db.tx():
        for entry in saved:
            tid = _store_track(db, entry_track(entry))
            if tid:
                db.x("insert or replace into saved(track_id, added_at) values(?,?)", (tid, entry.get("added_at")))
    return len(saved)


def history_files(paths):
    for path in paths:
        if str(path).lower().endswith(".zip"):
            with zipfile.ZipFile(path) as zf:
                for name in sorted(zf.namelist()):
                    base = name.rsplit("/", 1)[-1].lower()
                    if base.startswith("streaming_history_audio") and base.endswith(".json"):
                        yield json.loads(zf.read(name).decode("utf-8-sig"))
        else:
            with open(path, encoding="utf-8-sig") as fh:
                yield json.load(fh)


def import_history(db, paths, log=print):
    agg = {}
    for rows in history_files(paths):
        for row in rows:
            artist = row.get("master_metadata_album_artist_name")
            title = row.get("master_metadata_track_name")
            if not artist or not title:
                continue
            key = track_key(artist, title)
            item = agg.setdefault(key, {"artist": artist, "title": title, "plays": 0, "skips": 0, "ms": 0, "ts": ""})
            ms = int(row.get("ms_played") or 0)
            item["ms"] += ms
            if row.get("skipped") or ms < 30000:
                item["skips"] += 1
            else:
                item["plays"] += 1
            item["ts"] = max(item["ts"], row.get("ts") or "")
    with db.tx():
        for key, item in agg.items():
            db.x(
                "insert or replace into history(key, artist, title, plays, skips, ms_played, last_ts) "
                "values(?,?,?,?,?,?,?)",
                (key, item["artist"], item["title"], item["plays"], item["skips"], item["ms"], item["ts"]),
            )
        for rows in history_files(paths):
            for row in rows:
                artist = row.get("master_metadata_album_artist_name")
                title = row.get("master_metadata_track_name")
                if not artist or not title or not row.get("ts"):
                    continue
                uri = row.get("spotify_track_uri") or ""
                ms = int(row.get("ms_played") or 0)
                db.x(
                    "insert or ignore into listen_events(source, sp_id, dz_id, artist, title, played_at, ms_played, "
                    "skipped) values('history', ?, null, ?, ?, ?, ?, ?)",
                    (uri.rsplit(":", 1)[-1] or None, artist, title, row["ts"], ms,
                     int(bool(row.get("skipped")) or ms < 30000)),
                )
    log(f"  imported {len(agg)} distinct tracks from {len(paths)} files")
    return len(agg)


def known_sets(db):
    track_ids = {r[0] for r in db.q(
        "select ref from seeds where kind like 'track:%' union select track_id from saved "
        "union select track_id from plays union select track_id from playlist_tracks")}
    keys = {r[0] for r in db.q(
        f"select key from sp_tracks where id in (select ref from seeds where kind like 'track:%' "
        f"union select track_id from saved union select track_id from plays union select track_id from playlist_tracks)")}
    keys |= {r[0] for r in db.q("select key from history")}
    keys |= {r[0] for r in db.q("select key from dz_tracks where id in (select dz_id from recs)")}
    rec_sp = {r[0] for r in db.q("select sp_id from recs where sp_id is not null")}
    artist_ids = set()
    artist_norms = set()
    for row in db.q("select artist_ids, artists from sp_tracks where id in (select ref from seeds where kind like 'track:%' "
                    "union select track_id from saved union select track_id from plays "
                    "union select track_id from playlist_tracks)"):
        artist_ids.update(i for i in json.loads(row["artist_ids"] or "[]") if i)
        artist_norms.update(norm_artist(n) for n in json.loads(row["artists"] or "[]") if n)
    for row in db.q("select sp_artists.id, sp_artists.norm from sp_artists join seeds on seeds.ref = sp_artists.id "
                    "where seeds.kind like 'artist:%'"):
        artist_ids.add(row["id"])
        artist_norms.add(row["norm"])
    artist_norms |= {norm_artist(r[0]) for r in db.q("select artist from history where plays >= 2")}
    blocked = {r[0] for r in db.q("select artist_key from feedback where kind='never_artist'")}
    return {
        "track_ids": track_ids | rec_sp,
        "keys": keys,
        "artist_ids": artist_ids,
        "artist_norms": artist_norms - {""},
        "blocked_artists": blocked,
    }
