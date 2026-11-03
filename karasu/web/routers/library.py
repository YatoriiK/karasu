import asyncio
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...engine import home as H
from ...engine import spotify_lib as L
from ...engine.catalog import Catalog, parse_id
from ...net import NetError
from ...resolve import spotify_match
from ...sources.spotify import AuthError
from ...util import norm_artist, now_iso
from ..state import STATE, ctx

router = APIRouter(prefix="/api")


@router.get("/library/{kind}")
def library(kind: str, offset: int = 0, limit: int = 60):
    c = ctx()
    catalog = Catalog(c.db)
    if kind == "saved":
        rows = c.db.q("select track_id from saved order by added_at desc limit ? offset ?", (limit, offset))
        total = c.db.one("select count(*) from saved")[0]
        ids = catalog.library_ids([r[0] for r in rows])
    elif kind == "liked":
        rows = c.db.q("select dz_id from feedback where kind='up' and dz_id is not null group by dz_id "
                      "order by max(id) desc limit ? offset ?", (limit, offset))
        total = c.db.one("select count(distinct dz_id) from feedback where kind='up'")[0]
        ids = [f"dz:{r[0]}" for r in rows]
    elif kind == "recent":
        rows = c.db.q("select track_id, max(played_at) at from plays group by track_id order by at desc "
                      "limit ? offset ?", (limit, offset))
        total = c.db.one("select count(distinct track_id) from plays")[0]
        ids = catalog.library_ids([r[0] for r in rows])
    elif kind == "top":
        rows = c.db.q("select ref, sum(weight) w from seeds where kind like 'track:top_%' group by ref "
                      "order by w desc limit ? offset ?", (limit, offset))
        total = c.db.one("select count(distinct ref) from seeds where kind like 'track:top_%'")[0]
        ids = catalog.library_ids([r[0] for r in rows])
    else:
        raise HTTPException(404, "unknown library kind")
    return {"kind": kind, "total": total, "offset": offset, "items": catalog.tracks(ids)}


class Feedback(BaseModel):
    id: str
    kind: str


@router.post("/feedback")
def feedback(body: Feedback):
    c = ctx()
    kind, value = parse_id(body.id)
    dz_id = value if kind == "dz" else None
    sp_id = value if kind == "sp" else None
    artist = None
    if dz_id:
        row = c.db.one("select artist from dz_tracks where id=?", (dz_id,))
        artist = norm_artist(row[0]) if row else None
    elif sp_id:
        row = c.db.one("select json_extract(artists, '$[0]') from sp_tracks where id=?", (sp_id,))
        artist = norm_artist(row[0]) if row and row[0] else None
    if body.kind == "clear":
        c.db.x("delete from feedback where (dz_id=? and ?) or (sp_id=? and ?)", (dz_id, dz_id is not None,
                                                                                 sp_id, sp_id is not None))
    elif body.kind in ("up", "down", "never_artist"):
        c.db.x("delete from feedback where kind in ('up', 'down') and ((dz_id=? and ?) or (sp_id=? and ?))",
               (dz_id, dz_id is not None, sp_id, sp_id is not None))
        c.db.x("insert into feedback(dz_id, sp_id, artist_key, kind, at) values(?,?,?,?,?)",
               (dz_id, sp_id, artist, body.kind, now_iso()))
        if body.kind == "never_artist" and artist:
            c.db.x("insert or ignore into exclusions(kind, value, label, created) values('artist', ?, ?, ?)",
                   (artist, artist, now_iso()))
    else:
        raise HTTPException(400, "bad feedback kind")
    STATE.invalidate("home:")
    return {"ok": True, "track": (Catalog(c.db).tracks([body.id]) or [None])[0]}


class Exclusion(BaseModel):
    kind: str
    value: str
    label: str | None = None


@router.get("/exclusions")
def exclusions():
    rows = ctx().db.q("select kind, value, label, created from exclusions order by created desc")
    return [dict(r) for r in rows]


@router.post("/exclusions")
def add_exclusion(body: Exclusion):
    if body.kind not in ("artist", "genre", "track"):
        raise HTTPException(400, "bad kind")
    value = norm_artist(body.value) if body.kind == "artist" else body.value
    ctx().db.x("insert or replace into exclusions(kind, value, label, created) values(?,?,?,?)",
               (body.kind, value, body.label or body.value, now_iso()))
    STATE.invalidate("home:")
    return {"ok": True}


@router.delete("/exclusions/{kind}/{value}")
def remove_exclusion(kind: str, value: str):
    ctx().db.x("delete from exclusions where kind=? and value=?", (kind, value))
    STATE.invalidate("home:")
    return {"ok": True}


def _playlist(c, pid):
    catalog = Catalog(c.db)
    if pid.startswith("lane:"):
        lane = pid[5:]
        if lane not in ("fresh", "lost"):
            raise HTTPException(404, "unknown playlist")
        row = c.db.one("select sp_id from playlists where lane=?", (lane,))
        rows = c.db.q("select dz_id, reason, added_at from recs where lane=? and removed_at is null "
                      "order by added_at desc", (lane,))
        extra = {f"dz:{r['dz_id']}": {"reasons": H.split_reason(r["reason"])} for r in rows if r["reason"]}
        name = c.cfg["playlists"]["fresh_name"] if lane == "fresh" else c.cfg["playlists"]["lost_name"]
        return {"id": pid, "kind": "lane", "name": name, "sp_id": row[0] if row else None, "editable": False,
                "description": "New niche artists picked for you" if lane == "fresh"
                else "Older music almost nobody found",
                "tracks": catalog.tracks([f"dz:{r['dz_id']}" for r in rows], extra)}
    if pid.startswith("pl:"):
        row = c.db.one("select * from app_playlists where id=?", (int(pid[3:]),))
        if not row:
            raise HTTPException(404, "unknown playlist")
        items = c.db.q("select dz_id, sp_id from app_playlist_items where playlist_id=? order by pos", (row["id"],))
        ids = [f"dz:{r['dz_id']}" if r["dz_id"] else f"sp:{r['sp_id']}" for r in items]
        return {"id": pid, "kind": "playlist", "name": row["name"], "description": row["description"],
                "sp_id": row["sp_id"], "editable": True, "params": json.loads(row["params"] or "{}"),
                "cover": json.loads(row["cover"] or "null"), "tracks": catalog.tracks(ids)}
    if pid == "daily:mix":
        from ...engine import daily as D
        picks = D.ensure_picks(c, STATE.corpus)
        mix = D.mix_payload(c, STATE.corpus, picks)
        if not mix:
            raise HTTPException(404, "no daily mix yet")
        return {"id": pid, "kind": "daily", "name": "Daily Mix", "sp_id": None, "editable": False,
                "description": f"{mix['known']} favorites and {mix['new']} new finds · refreshed every morning",
                "date": picks.get("date"), "tracks": mix["tracks"]}
    if pid.startswith("sp:"):
        try:
            data = L.playlist_detail(c, pid[3:])
        except AuthError as exc:
            raise HTTPException(401, str(exc))
        except NetError as exc:
            raise HTTPException(502, str(exc))
        if not data:
            raise HTTPException(404, "unknown playlist")
        return data
    raise HTTPException(404, "unknown playlist")


def _refresh_spotify(jc):
    c = jc.ctx
    if not (c.sp.configured and c.sp.has_login()):
        return {"skipped": True}
    jc.progress("Syncing your Spotify playlists", 0, 2, force=True)
    lists = L.refresh_playlists(c)
    jc.progress("Syncing your liked songs", 1, 2, force=True)
    liked = L.sync_liked(c)
    STATE.invalidate("home:")
    return {**lists, **liked}


def refresh_spotify_soon(c, force=False):
    if not (c.sp.configured and c.sp.has_login()):
        return None
    if force or L.stale(c.db, "sp_playlists_synced", 15) or L.stale(c.db, "liked_synced", 360):
        return STATE.jobs.submit("spotify-library", _refresh_spotify, label="Syncing your Spotify library")
    return None


@router.get("/playlists")
async def playlists():
    c = ctx()

    def run():
        if c.db.meta("sp_playlists_synced") is None and c.sp.configured and c.sp.has_login():
            try:
                L.refresh_playlists(c, with_items=False)
            except (NetError, AuthError):
                pass
        refresh_spotify_soon(c)
        spotify = L.playlist_rows(c)
        on_spotify = {p["sp_id"] for p in spotify}
        local = [p for p in H.lanes(c) if not p.get("sp_id") or p["sp_id"] not in on_spotify]
        ids = sorted({t for p in local for t in p["track_ids"]})
        art = {t["id"]: t["art"] for t in Catalog(c.db).tracks(ids)}
        for p in local:
            p["art"] = [art.get(t) for t in p["track_ids"] if art.get(t)]
            p["editable"] = p["kind"] == "playlist"
            p["own"] = True
        return spotify + local

    return await asyncio.to_thread(run)


@router.post("/library/sync")
def sync_library():
    job = refresh_spotify_soon(ctx(), force=True)
    return {"job": job}


class TrackIds(BaseModel):
    track_ids: list[str]


def _sp_ids(c, track_ids):
    ids = spotify_ids_for(c, track_ids)
    if not ids:
        raise HTTPException(404, "None of these songs are on Spotify")
    return ids


def _spotify_edit(fn):
    try:
        return fn()
    except AuthError as exc:
        raise HTTPException(401, str(exc))
    except NetError as exc:
        raise HTTPException(502, str(exc))


def _local_ids(c, playlist_id):
    rows = c.db.q("select dz_id, sp_id from app_playlist_items where playlist_id=? order by pos", (playlist_id,))
    return [f"dz:{r['dz_id']}" if r["dz_id"] else f"sp:{r['sp_id']}" for r in rows]


@router.post("/playlists/{pid}/tracks")
async def add_to_playlist(pid: str, body: TrackIds):
    c = ctx()

    def run():
        if pid.startswith("sp:"):
            count = _spotify_edit(lambda: L.add_tracks(c, pid[3:], _sp_ids(c, body.track_ids)))
            return {"ok": True, "added": count}
        if pid.startswith("pl:"):
            playlist_id = int(pid[3:])
            ids = _local_ids(c, playlist_id)
            ids += [t for t in body.track_ids if t not in ids]
            _write_items(c, playlist_id, ids)
            c.db.x("update app_playlists set updated=? where id=?", (now_iso(), playlist_id))
            STATE.invalidate("home:")
            return {"ok": True, "added": len(body.track_ids)}
        raise HTTPException(400, "This playlist can't be edited")

    return await asyncio.to_thread(run)


@router.post("/playlists/{pid}/tracks/remove")
async def remove_from_playlist(pid: str, body: TrackIds):
    c = ctx()

    def run():
        if pid.startswith("sp:"):
            count = _spotify_edit(lambda: L.remove_tracks(c, pid[3:], _sp_ids(c, body.track_ids)))
            return {"ok": True, "removed": count}
        if pid.startswith("pl:"):
            playlist_id = int(pid[3:])
            drop = set(body.track_ids)
            _write_items(c, playlist_id, [i for i in _local_ids(c, playlist_id) if i not in drop])
            STATE.invalidate("home:")
            return {"ok": True, "removed": len(drop)}
        raise HTTPException(400, "This playlist can't be edited")

    return await asyncio.to_thread(run)


class NewPlaylist(BaseModel):
    name: str
    description: str | None = ""
    track_ids: list[str] = []


@router.post("/spotify/playlists")
async def create_spotify_playlist(body: NewPlaylist):
    c = ctx()

    def run():
        ids = spotify_ids_for(c, body.track_ids) if body.track_ids else []
        name = body.name.strip()[:100] or "Untitled"
        sp_id = _spotify_edit(lambda: L.create_playlist(c, name, body.description, ids))
        return {"ok": True, "id": f"sp:{sp_id}", "matched": len(ids), "total": len(body.track_ids)}

    return await asyncio.to_thread(run)


@router.get("/playlists/{pid}")
def playlist(pid: str):
    return _playlist(ctx(), pid)


class PlaylistBody(BaseModel):
    name: str
    description: str | None = ""
    track_ids: list[str] = []
    params: dict | None = None
    cover: dict | None = None


def _write_items(c, playlist_id, track_ids):
    c.db.x("delete from app_playlist_items where playlist_id=?", (playlist_id,))
    stamp = now_iso()
    for pos, tid in enumerate(track_ids):
        kind, value = parse_id(tid)
        c.db.x("insert into app_playlist_items(playlist_id, pos, dz_id, sp_id, added_at) values(?,?,?,?,?)",
               (playlist_id, pos, value if kind == "dz" else None, value if kind == "sp" else None, stamp))


@router.post("/playlists")
def create_playlist(body: PlaylistBody):
    c = ctx()
    stamp = now_iso()
    with c.db.tx():
        cur = c.db.x("insert into app_playlists(name, description, cover, params, created, updated) "
                     "values(?,?,?,?,?,?)", (body.name.strip()[:100] or "Untitled", body.description or "",
                                             json.dumps(body.cover), json.dumps(body.params or {}), stamp, stamp))
        pid = cur.lastrowid
        _write_items(c, pid, body.track_ids)
    STATE.invalidate("home:")
    return _playlist(c, f"pl:{pid}")


@router.put("/playlists/{pid}")
def update_playlist(pid: str, body: PlaylistBody):
    c = ctx()
    if not pid.startswith("pl:"):
        raise HTTPException(400, "only your own playlists can be edited")
    playlist_id = int(pid[3:])
    with c.db.tx():
        c.db.x("update app_playlists set name=?, description=?, cover=coalesce(?, cover), "
               "params=coalesce(?, params), updated=? where id=?",
               (body.name.strip()[:100] or "Untitled", body.description or "",
                json.dumps(body.cover) if body.cover is not None else None,
                json.dumps(body.params) if body.params is not None else None, now_iso(), playlist_id))
        _write_items(c, playlist_id, body.track_ids)
    STATE.invalidate("home:")
    return _playlist(c, pid)


@router.delete("/playlists/{pid}")
def delete_playlist(pid: str):
    c = ctx()
    if not pid.startswith("pl:"):
        raise HTTPException(400, "only your own playlists can be deleted")
    with c.db.tx():
        c.db.x("delete from app_playlist_items where playlist_id=?", (int(pid[3:]),))
        c.db.x("delete from app_playlists where id=?", (int(pid[3:]),))
    STATE.invalidate("home:")
    return {"ok": True}


def known_spotify_id(c, tid):
    kind, value = parse_id(tid)
    if kind == "sp":
        return True, value
    row = c.db.one("select sp_id from dz_sp where dz_id=?", (value,))
    if row:
        return True, row[0]
    row = c.db.one("select sp_id from sp_dz where dz_id=? limit 1", (value,))
    if row:
        return True, row[0]
    return False, None


def spotify_id_for(c, tid):
    known, sp_id = known_spotify_id(c, tid)
    if known:
        return sp_id
    _, value = parse_id(tid)
    full = c.dz.track(value) or {}
    match = spotify_match(c, full) if full.get("id") else None
    c.db.x("insert or replace into dz_sp(dz_id, sp_id, checked_at) values(?,?,?)",
           (value, match["id"] if match else None, now_iso()))
    return match["id"] if match else None


def spotify_ids_for(c, track_ids):
    return [sp_id for sp_id in (spotify_id_for(c, tid) for tid in track_ids) if sp_id]


@router.post("/playlists/{pid}/spotify")
async def push_playlist(pid: str):
    c = ctx()

    def run():
        data = _playlist(c, pid)
        if data["kind"] != "playlist":
            raise HTTPException(400, "Karasu playlists already live in Spotify")
        try:
            sp_ids = spotify_ids_for(c, [t["id"] for t in data["tracks"]])
            row = c.db.one("select sp_id from app_playlists where id=?", (int(pid[3:]),))
            sp_playlist = row[0] if row and row[0] else None
            if sp_playlist:
                current = c.sp.playlist_items(sp_playlist)
                from ...sources.spotify import entry_track
                uris = [f"spotify:track:{t['id']}" for t in (entry_track(e) for e in current) if t and t.get("id")]
                if uris:
                    c.sp.remove_items(sp_playlist, uris)
            else:
                created = c.sp.create_playlist(data["name"], data.get("description") or "Made with Karasu", False)
                sp_playlist = created["id"]
                c.db.x("update app_playlists set sp_id=? where id=?", (sp_playlist, int(pid[3:])))
            if sp_ids:
                c.sp.add_items(sp_playlist, [f"spotify:track:{s}" for s in sp_ids])
        except AuthError as exc:
            raise HTTPException(401, str(exc))
        except NetError as exc:
            raise HTTPException(502, str(exc))
        return {"ok": True, "sp_id": sp_playlist, "matched": len(sp_ids), "total": len(data["tracks"])}

    return await asyncio.to_thread(run)


@router.get("/tracks/{tid}/links")
async def track_links(tid: str):
    c = ctx()

    def run():
        kind, value = parse_id(tid)
        try:
            sp_id = spotify_id_for(c, tid)
        except (NetError, AuthError):
            sp_id = known_spotify_id(c, tid)[1]
        return {"spotify": f"https://open.spotify.com/track/{sp_id}" if sp_id else None,
                "deezer": f"https://www.deezer.com/track/{value}" if kind == "dz" else None}

    return await asyncio.to_thread(run)
