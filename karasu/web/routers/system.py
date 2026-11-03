import asyncio
import json
import re

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ... import __version__
from ...sources.discogs import Discogs
from ...sources.lastfm import LastFM
from ..state import STATE, ctx

router = APIRouter(prefix="/api")

SETTINGS = [
    ("fresh.debut_max_years", "New artists: debuted within (years)", 1, 8, 1),
    ("fresh.fans_cap", "New artists: max Deezer fans", 500, 50000, 500),
    ("lost.older_than_years", "Lost & Found: older than (years)", 10, 50, 1),
    ("lost.fans_cap", "Lost & Found: max Deezer fans", 500, 50000, 500),
    ("selection.mmr_lambda", "Focus vs. variety", 0.4, 0.95, 0.05),
    ("playlists.add_per_week", "New songs per playlist each week", 5, 40, 1),
]


@router.get("/health")
def health():
    c = STATE.ctx
    if c is None:
        return {"ok": False, "starting": True, "version": __version__}
    steps = c.db.meta("backfill_steps", [])
    return {
        "ok": True,
        "version": __version__,
        "spotify": {"configured": c.sp.configured, "logged_in": c.sp.has_login(),
                    "user": c.db.meta("spotify_user", {})},
        "backfill": {"steps": steps, "running": [j for j in STATE.jobs.running() if j.get("kind") == "backfill"]},
        "keys": {"lastfm": c.lfm.enabled, "discogs": c.dg.enabled},
        "corpus": len(STATE.corpus.ids) if STATE.corpus else 0,
    }


@router.get("/events")
async def events():
    async def stream():
        yield "retry: 3000\n\n"
        for job in STATE.jobs.running():
            yield f"data: {json.dumps({'type': 'job', **job}, default=str)}\n\n"
        async for event in STATE.bus.stream():
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/jobs")
def jobs():
    return {"running": STATE.jobs.running(), "recent": STATE.jobs.recent()}


@router.get("/jobs/{job_id}")
def job(job_id: str):
    data = STATE.jobs.get(job_id)
    if not data:
        raise HTTPException(404, "no such job")
    return data


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str):
    return {"ok": STATE.jobs.cancel(job_id)}


class Backfill(BaseModel):
    steps: list[str] | None = None


@router.post("/jobs/backfill")
def backfill(body: Backfill):
    from ...engine.backfill import first_run
    job_id = STATE.jobs.submit("backfill", first_run, {"steps": body.steps}, label="Preparing your library")
    return {"job": job_id}


@router.post("/admin/shutdown")
async def shutdown():
    if STATE.server is not None:
        loop = asyncio.get_running_loop()
        loop.call_later(0.2, lambda: setattr(STATE.server, "should_exit", True))
    return {"ok": True}


def _get(cfg, dotted):
    node = cfg
    for part in dotted.split("."):
        node = node[part]
    return node


def _set(cfg, dotted, value):
    parts = dotted.split(".")
    node = cfg
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


@router.get("/settings")
def get_settings():
    c = ctx()
    return [{"key": k, "label": label, "min": lo, "max": hi, "step": step, "value": _get(c.cfg, k)}
            for k, label, lo, hi, step in SETTINGS]


class Setting(BaseModel):
    key: str
    value: float


@router.post("/settings")
def set_setting(body: Setting):
    c = ctx()
    spec = {k: (lo, hi, step) for k, _, lo, hi, step in SETTINGS}.get(body.key)
    if not spec:
        raise HTTPException(400, "unknown setting")
    lo, hi, step = spec
    value = min(hi, max(lo, body.value))
    value = int(round(value)) if float(step).is_integer() else round(value, 3)
    c.db.set_setting(body.key, value)
    _set(c.cfg, body.key, value)
    return {"ok": True, "value": value}


KEYS = {
    "lastfm": ("lastfm.api_key", re.compile(r"^[0-9a-fA-F]{32}$"), "Last.fm", "an API key (32 letters and numbers)"),
    "discogs": ("discogs.token", re.compile(r"^[A-Za-z0-9]{20,80}$"), "Discogs", "a personal access token"),
}


def _key_works(c, service, value):
    try:
        if service == "lastfm":
            resp = c.net.client.get("https://ws.audioscrobbler.com/2.0/", timeout=12, params={
                "method": "chart.getTopArtists", "api_key": value, "format": "json", "limit": 1})
            return resp.status_code == 200 and "error" not in resp.json()
        resp = c.net.client.get("https://api.discogs.com/oauth/identity", timeout=12,
                                headers={"Authorization": f"Discogs token={value}"})
        return resp.status_code == 200
    except (httpx.HTTPError, ValueError):
        return None


class Key(BaseModel):
    value: str


@router.put("/keys/{service}")
async def put_key(service: str, body: Key):
    if service not in KEYS:
        raise HTTPException(404, "unknown service")
    c = ctx()
    dotted, pattern, name, what = KEYS[service]
    value = body.value.strip()
    if value:
        if not pattern.match(value):
            raise HTTPException(400, f"That doesn't look like {what} from {name}.")
        works = await asyncio.to_thread(_key_works, c, service, value)
        if works is None:
            raise HTTPException(502, f"Couldn't reach {name} to check it. Try again in a moment.")
        if not works:
            raise HTTPException(400, f"{name} didn't accept that. Copy it again and paste the whole thing.")
    c.db.set_setting(dotted, value)
    _set(c.cfg, dotted, value)
    if service == "lastfm":
        c.lfm = LastFM(c.net, value)
    else:
        c.dg = Discogs(c.net, value)
    return {"lastfm": c.lfm.enabled, "discogs": c.dg.enabled}


@router.get("/prefs")
def get_prefs():
    return ctx().db.prefs()


@router.put("/prefs")
def put_prefs(body: dict):
    c = ctx()
    for key, value in body.items():
        if len(key) > 64:
            raise HTTPException(400, "bad key")
        c.db.set_pref(key, value)
    return c.db.prefs()


def _folder(path, pattern="*"):
    files = [p for p in path.rglob(pattern) if p.is_file()] if path.exists() else []
    return {"files": len(files), "bytes": sum(p.stat().st_size for p in files)}


@router.get("/storage")
async def storage():
    from ... import DATA
    from ...audio import AUDIO_CACHE
    from ...engine.media import ART

    def run():
        db_bytes = sum(p.stat().st_size for p in DATA.glob("music.db*") if p.is_file())
        return {"audio": _folder(AUDIO_CACHE, "*.mp3"), "art": _folder(ART), "database": db_bytes,
                "location": str(DATA.parent)}

    return await asyncio.to_thread(run)


@router.post("/storage/clear-audio")
async def clear_audio():
    from ...audio import AUDIO_CACHE

    def run():
        removed = 0
        for path in AUDIO_CACHE.glob("*.mp3") if AUDIO_CACHE.exists() else []:
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
        return {"removed": removed}

    return await asyncio.to_thread(run)


@router.delete("/search/history")
def clear_search_history():
    ctx().db.x("delete from search_history")
    return {"ok": True}


@router.post("/history/reset")
def reset_history():
    c = ctx()
    with c.db.tx():
        removed = c.db.one("select count(*) from listen_events")[0]
        c.db.x("delete from listen_events")
    STATE.invalidate("")
    return {"removed": removed}
