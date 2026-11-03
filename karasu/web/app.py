import asyncio
import ctypes
import logging
import threading
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from .. import ROOT
from ..audio import prune_audio_cache, release_shared
from ..engine.corpus import Corpus
from ..engine.jobs import EventBus, JobManager
from .routers import catalog, daily, deskfile, discover, insight, library, media, player, setup, system, workspace
from .state import STATE

DIST = ROOT / "ui" / "dist"
ORIGINS = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
           "http://localhost:5173", "http://127.0.0.1:5173"]
log = logging.getLogger("karasu")


def _snapshot(jc):
    from ..publish import update_outcomes
    from ..sync import snapshot_recent, snapshot_saved
    c = jc.ctx
    if not (c.sp.configured and c.sp.has_login()):
        return {"skipped": True}
    from ..engine import spotify_lib
    plays = snapshot_recent(c.sp, c.db)
    saved = snapshot_saved(c.sp, c.db, pages=1)
    update_outcomes(c)
    out = {"plays": plays, "saved": saved}
    try:
        out.update(spotify_lib.refresh_playlists(c))
        if spotify_lib.stale(c.db, "liked_synced", 360):
            out.update(spotify_lib.sync_liked(c))
    except Exception as exc:
        log.warning("spotify library refresh failed: %s", exc)
    return out


async def _periodic(app_state):
    from ..engine import genres as G
    await asyncio.sleep(20)
    while True:
        try:
            app_state.jobs.submit("snapshot", _snapshot, label="Checking what you played")
            if "genres" in set(app_state.ctx.db.meta("backfill_steps", [])):
                app_state.jobs.submit("genres", lambda jc: G.refresh(jc, app_state.corpus), key="genres",
                                      label="Learning genres")
        except Exception as exc:
            log.warning("snapshot scheduling failed: %s", exc)
        await asyncio.sleep(30 * 60)


async def _first_run(app_state):
    from ..engine import facets as F
    from ..engine.backfill import STEPS, facets_backfill, first_run
    await asyncio.sleep(3)
    db = app_state.ctx.db
    done = set(db.meta("backfill_steps", []))
    if any(key not in done for key, _, _ in STEPS):
        app_state.jobs.submit("backfill", first_run, {"steps": None}, label="Preparing your library")
    if "facets" in done and (db.meta("facet_concepts") or {}).get("version") != F.VERSION:
        app_state.jobs.submit("facets", facets_backfill, label="Describing every sound")


def make_lifespan(context=None, background=True):
    @asynccontextmanager
    async def lifespan(app):
        from ..context import Ctx
        STATE.bus = EventBus()
        STATE.bus.attach(asyncio.get_running_loop())
        STATE.ctx = context or await asyncio.to_thread(Ctx)
        STATE.jobs = JobManager(STATE.ctx, STATE.bus)
        STATE.corpus = Corpus(STATE.ctx)
        await asyncio.to_thread(STATE.corpus.refresh)
        tasks = []
        if background:
            await asyncio.to_thread(STATE.corpus.fit)
            tasks.append(asyncio.create_task(_periodic(STATE)))
            tasks.append(asyncio.create_task(_first_run(STATE)))
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            STATE.jobs.shutdown()
            release_shared()
            await asyncio.to_thread(prune_audio_cache)
            if context is None:
                STATE.ctx.close()
            STATE.ctx = None

    return lifespan


def create_app(context=None, background=True):
    app = FastAPI(title="Karasu", lifespan=make_lifespan(context, background), docs_url=None, redoc_url=None)
    # Only answer to 127.0.0.1 and localhost, so a random website can't DNS-rebind its way into your library.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])
    app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"],
                       allow_private_network=True, max_age=600)
    for module in (system, catalog, daily, library, media, discover, player, insight, deskfile, workspace, setup):
        app.include_router(module.router)

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        if path:
            target = (DIST / path).resolve()
            if target.is_file() and DIST.resolve() in target.parents:
                cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
                return FileResponse(target, headers={"Cache-Control": cache})
        index = DIST / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return HTMLResponse("<h1>Karasu</h1><p>The engine is running. Open the Karasu app, or build the UI "
                            "with <code>npm run build</code> in <code>ui</code> to use it in a browser.</p>")

    return app


def _parent_alive(pid):
    SYNCHRONIZE = 0x00100000
    handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, int(pid))
    if not handle:
        return False
    try:
        return ctypes.windll.kernel32.WaitForSingleObject(handle, 0) == 0x102
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


# If the desktop app dies without saying goodbye, the engine notices within two seconds and quits
# instead of haunting Task Manager.
def _watch_parent(pid):
    while True:
        time.sleep(2)
        if not _parent_alive(pid):
            log.info("parent %s is gone, shutting down", pid)
            if STATE.server is not None:
                STATE.server.should_exit = True
            return


def serve(port=8765, parent_pid=None, background=True):
    config = uvicorn.Config(create_app(background=background), host="127.0.0.1", port=port, log_level="warning",
                            timeout_keep_alive=30)
    server = uvicorn.Server(config)
    STATE.server = server
    if parent_pid:
        threading.Thread(target=_watch_parent, args=(parent_pid,), daemon=True).start()
    server.run()
