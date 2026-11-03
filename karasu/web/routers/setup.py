import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...engine import setup as S
from ...engine.catalog import Catalog
from ...engine.search import _store_artist
from ...net import NetError
from ...sources.spotify import Spotify
from ...util import now_iso
from ..state import STATE, ctx

router = APIRouter(prefix="/api")
CLIENT_ID = re.compile(r"^[0-9a-f]{32}$")
PATHS = ("premium", "free", "skip")


def _job(job_id):
    data = STATE.jobs.get(job_id) if job_id and STATE.jobs else None
    if not data:
        return None
    return {k: data.get(k) for k in ("id", "status", "stage", "done", "total", "error")}


def _later(jc):
    from ...engine.backfill import first_run
    return first_run(jc, steps=list(S.LATER))


def _refresh(fn):
    def work(jc):
        out = fn(jc)
        if STATE.corpus is not None:
            STATE.corpus.refresh(force=True)
        STATE.invalidate("")
        STATE.jobs.submit("genres", _later, key="setup:later", label="Learning genres")
        return out
    return work


def start_sync(c):
    job = STATE.jobs.submit("setup", _refresh(S.sync_spotify), key="setup:spotify", label="Getting your music ready")
    S.update(c.db, job=job)
    return job


@router.get("/setup")
def setup_state():
    c = ctx()
    s = S.state(c.db)
    logged = c.sp.configured and c.sp.has_login()
    library = S.has_library(c.db)
    return {
        "done": bool(s.get("done")),
        "needed": not s.get("done") and not logged and not library,
        "path": s.get("path"),
        "history_requested": bool(s.get("history_requested")),
        "redirect_uri": c.sp.redirect_uri,
        "client_id": c.sp.client_id,
        "spotify": {"configured": c.sp.configured, "logged_in": logged, "user": c.db.meta("spotify_user", {})},
        "library": library,
        "synced": S.synced(c.db),
        "picks": Catalog(c.db).artists(S.picks(c.db)),
        "job": _job(s.get("job")),
    }


class ClientId(BaseModel):
    client_id: str


@router.put("/setup/spotify")
def set_client_id(body: ClientId):
    value = body.client_id.strip().lower()
    if not CLIENT_ID.match(value):
        raise HTTPException(400, "That doesn't look like a Client ID. It's 32 letters and numbers from your app's page.")
    c = ctx()
    c.db.set_setting("spotify.client_id", value)
    c.cfg["spotify"]["client_id"] = value
    if value != c.sp.client_id:
        c.sp = Spotify(c.net, value, c.cfg["spotify"]["redirect_port"])
    S.update(c.db, path="premium")
    STATE.invalidate("me")
    return setup_state()


@router.post("/setup/sync")
def setup_sync():
    c = ctx()
    if not (c.sp.configured and c.sp.has_login()):
        raise HTTPException(400, "Connect Spotify first")
    return {"job": start_sync(c)}


@router.get("/setup/artists")
def setup_artists(q: str = ""):
    c = ctx()
    text = q.strip()[:80]
    try:
        found = c.dz.search_artist(text, limit=18) if text else c.dz.chart_artists(limit=24)
    except NetError as exc:
        raise HTTPException(502, "Couldn't reach Deezer to look up artists. Check your connection.") from exc
    ids = []
    with c.db.tx():
        for a in found:
            if a.get("id") and a.get("name") and a["id"] not in ids:
                _store_artist(c.db, a)
                ids.append(a["id"])
    return Catalog(c.db).artists(ids)


class Picks(BaseModel):
    artist_ids: list[int]


@router.put("/setup/picks")
def setup_picks(body: Picks):
    c = ctx()
    ids = list(dict.fromkeys(int(i) for i in body.artist_ids))[:S.MAX_PICKS]
    if len(ids) < S.MIN_PICKS:
        raise HTTPException(400, f"Pick at least {S.MIN_PICKS} artists")
    known = {r[0] for r in c.db.q(f"select id from dz_artists where id in ({','.join('?' * len(ids))})", ids)}
    if any(i not in known for i in ids):
        raise HTTPException(400, "Some of those artists aren't known yet. Search for them again.")
    S.save_picks(c.db, ids)
    job = STATE.jobs.submit("setup", _refresh(S.learn_picks), key="setup:picks", label="Learning your taste")
    S.update(c.db, path="free", job=job)
    return {"job": job}


class Finish(BaseModel):
    path: str | None = None
    history_requested: bool | None = None


@router.post("/setup/finish")
def finish(body: Finish):
    c = ctx()
    values = {"done": True, "finished_at": now_iso()}
    if body.path in PATHS:
        values["path"] = body.path
    if body.history_requested is not None:
        values["history_requested"] = body.history_requested
    S.update(c.db, **values)
    return setup_state()
