import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...engine import explore as X
from ...engine import genres as G
from ...engine import insight as I
from ...engine import listeners as LS
from ...engine import profile as P
from ...engine.catalog import Catalog, parse_id
from ...util import now_iso
from ..state import STATE, ctx

router = APIRouter(prefix="/api")


@router.get("/stats")
async def stats(range: str = "month"):
    if range not in I.RANGES:
        raise HTTPException(400, "range must be week, month, year or all")
    c = ctx()
    return await asyncio.to_thread(lambda: STATE.memo(f"stats:{range}", 60, lambda: I.stats(c, range)))


@router.get("/profile")
async def profile():
    c = ctx()

    def go():
        STATE.corpus.refresh()
        return STATE.memo(f"profile:{STATE.corpus.stamp}", 600, lambda: I.profile(c, STATE.corpus))

    return await asyncio.to_thread(go)


@router.get("/me")
async def me():
    c = ctx()
    return await asyncio.to_thread(lambda: STATE.memo("me", 120, lambda: P.user_profile(c)))


@router.get("/listeners")
async def listeners(artist: str | None = None, sp: str | None = None, track: str | None = None, retry: bool = False):
    if not (artist or sp or track):
        raise HTTPException(400, "pick an artist or a song")
    c = ctx()
    return await asyncio.to_thread(LS.lookup, c, artist, sp, track, retry=retry)


class Switch(BaseModel):
    enabled: bool


@router.get("/listeners/enabled")
def listeners_enabled():
    return {"enabled": LS.enabled(ctx().db)}


@router.put("/listeners/enabled")
def set_listeners_enabled(body: Switch):
    c = ctx()
    LS.set_enabled(c.db, body.enabled)
    return {"enabled": LS.enabled(c.db)}


class Prefetch(BaseModel):
    artists: list[str]


@router.post("/listeners/prefetch")
async def prefetch_listeners(body: Prefetch):
    c = ctx()
    return await asyncio.to_thread(LS.prefetch, c, body.artists[:6])


@router.get("/profile/export")
async def export():
    c = ctx()
    return await asyncio.to_thread(I.export_profile, c, STATE.corpus)


@router.post("/compare")
async def compare(body: dict):
    # Old name, kept so profile files people already exported still load.
    if body.get("format") != "karasu-profile":
        raise HTTPException(400, "That isn't a Karasu profile file")
    c = ctx()
    return await asyncio.to_thread(I.compare, c, STATE.corpus, body)


@router.get("/history")
def history(offset: int = 0, limit: int = 80):
    c = ctx()
    rows = c.db.q("select id, source, sp_id, dz_id, artist, title, played_at, ms_played from listen_events "
                  "order by played_at desc limit ? offset ?", (limit, offset))
    total = c.db.one("select count(*) from listen_events")[0]
    catalog = Catalog(c.db)
    sp_ids = [r["sp_id"] for r in rows if r["sp_id"]]
    lib = dict(zip(sp_ids, catalog.library_ids(sp_ids)))
    ids = [f"dz:{r['dz_id']}" if r["dz_id"] else lib.get(r["sp_id"]) for r in rows]
    tracks = {t["id"]: t for t in catalog.tracks([i for i in ids if i])}
    items = []
    for r, tid in zip(rows, ids):
        items.append({"played_at": r["played_at"], "source": r["source"], "track": tracks.get(tid),
                      "artist": r["artist"], "title": r["title"]})
    return {"total": total, "offset": offset, "items": items}


class ImportBody(BaseModel):
    paths: list[str]


@router.post("/import/history")
def import_history(body: ImportBody):
    paths = [p for p in body.paths if p.lower().endswith((".json", ".zip")) and Path(p).is_file()]
    if not paths:
        raise HTTPException(400, "Pick the ZIP Spotify sent you, or the Streaming_History_Audio_*.json files inside it")

    def work(jc, files):
        from ...sync import import_history as run
        jc.progress("Importing your listening history", 0, len(files), force=True)
        count = run(jc.ctx.db, files, log=lambda m: None)
        STATE.invalidate("stats:")
        return {"tracks": count}

    return {"job": STATE.jobs.submit("import", work, {"files": paths}, label="Importing your history")}


class PlayEvent(BaseModel):
    id: str
    ms: int = 0


@router.post("/player/events")
def player_event(body: PlayEvent):
    c = ctx()
    kind, value = parse_id(body.id)
    if kind == "dz":
        row = c.db.one("select artist, title from dz_tracks where id=?", (value,))
    else:
        row = c.db.one("select json_extract(artists, '$[0]') artist, name title from sp_tracks where id=?", (value,))
    if not row:
        return {"ok": False}
    c.db.x("insert or ignore into listen_events(source, sp_id, dz_id, artist, title, played_at, ms_played, skipped) "
           "values('app', ?, ?, ?, ?, ?, ?, 0)",
           (value if kind == "sp" else None, value if kind == "dz" else None, row["artist"], row["title"], now_iso(),
            body.ms))
    return {"ok": True}


@router.get("/explore")
async def explore():
    c = ctx()

    def go():
        STATE.corpus.refresh()
        key = f"explore:{G.signature(c, STATE.corpus)}:{(c.db.meta('facet_concepts') or {}).get('version')}"
        return STATE.memo(key, 600, lambda: X.overview(c, STATE.corpus))

    return await asyncio.to_thread(go)


@router.get("/genres/{key}")
async def genre(key: str):
    c = ctx()

    def go():
        STATE.corpus.refresh()
        version = (c.db.meta("facet_concepts") or {}).get("version")
        return STATE.memo(f"genre:{key}:{G.signature(c, STATE.corpus)}:{version}", 300,
                          lambda: X.genre_page(c, STATE.corpus, key))

    page = await asyncio.to_thread(go)
    if page is None:
        raise HTTPException(404, "unknown genre")
    return page


@router.post("/genres/refresh")
def refresh_genres():
    job = STATE.jobs.submit("genres", lambda jc: G.refresh(jc, STATE.corpus, retrain=True), key="genres",
                            label="Learning genres")
    return {"job": job}


@router.get("/explore/trending")
async def trending():
    c = ctx()
    return await asyncio.to_thread(lambda: STATE.memo("trending", 3600, lambda: X.trending(c, STATE.corpus)))


class ExploreQuery(BaseModel):
    genre: str | None = None
    mood: str | None = None
    instrument: str | None = None
    decade: str | None = None
    year_from: int | None = None
    year_to: int | None = None
    popularity: str | None = None
    energy: list[float] | None = None
    tempo: list[float] | None = None
    sort: str = "taste"
    limit: int = 60
    offset: int = 0


@router.post("/explore/query")
async def explore_query(body: ExploreQuery):
    c = ctx()
    filters = body.model_dump(exclude={"limit", "offset"})
    return await asyncio.to_thread(X.query, c, STATE.corpus, filters, min(body.limit, 120), body.offset)
