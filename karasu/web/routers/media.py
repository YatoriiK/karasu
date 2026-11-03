import asyncio

import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from ...audio import fetch_preview, preview_path
from ...engine import media
from ...engine.catalog import parse_id
from ..state import ctx
from .library import known_spotify_id

router = APIRouter(prefix="/api")
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


@router.get("/audio/{dz_id}")
async def audio(dz_id: int):
    c = ctx()
    path = preview_path(dz_id)
    if not (path.exists() and path.stat().st_size > 1000):
        data = await asyncio.to_thread(fetch_preview, c, dz_id)
        if not data:
            c.db.set_meta(f"nopreview:{dz_id}", True)
            raise HTTPException(404, "no preview")
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/art/{kind}/{ref}")
async def art(kind: str, ref: str, s: int = 320):
    if not media.valid(kind, ref):
        raise HTTPException(400, "bad art ref")
    path = await asyncio.to_thread(media.ensure_sized, ctx(), kind, ref, s)
    if path is None:
        raise HTTPException(404, "no art")
    return FileResponse(path, media_type="image/webp", headers=IMMUTABLE)


@router.get("/art/{kind}/{ref}/palette")
async def palette(kind: str, ref: str):
    if not media.valid(kind, ref):
        raise HTTPException(400, "bad art ref")
    return await asyncio.to_thread(media.palette, ctx(), kind, ref) or {}


def _spotify_signature(c, sp_id):
    row = c.db.one("select name, json_extract(artists, '$[0]') artist, album, duration_ms from sp_tracks where id=?",
                   (sp_id,))
    if row:
        return {"artist": row["artist"], "title": row["name"], "album": row["album"],
                "duration": (row["duration_ms"] or 0) / 1000 or None}
    try:
        full = c.sp.track(sp_id) or {}
    except Exception:
        return None
    artists = full.get("artists") or [{}]
    return {"artist": artists[0].get("name"), "title": full.get("name"), "album": (full.get("album") or {}).get("name"),
            "duration": (full.get("duration_ms") or 0) / 1000 or None} if full.get("name") else None


def lyric_signatures(c, track_id):
    kind, value = parse_id(track_id)
    if kind == "dz":
        dz_id, sp_id = value, known_spotify_id(c, track_id)[1]
    else:
        row = c.db.one("select dz_id from sp_dz where sp_id=? and dz_id > 0 limit 1", (value,))
        dz_id, sp_id = (row[0] if row else None), value
    row = c.db.one("select title, artist, album, duration from dz_tracks where id=?", (dz_id,)) if dz_id else None
    deezer = {"artist": row["artist"], "title": row["title"], "album": row["album"],
              "duration": row["duration"]} if row else None
    if kind == "dz" and not deezer:
        return []
    spotify = _spotify_signature(c, sp_id) if sp_id else None
    return [s for s in ((deezer, spotify) if kind == "dz" else (spotify, deezer)) if s]


@router.get("/lyrics/{track_id}")
async def lyrics(track_id: str):
    c = ctx()
    sigs = await asyncio.to_thread(lyric_signatures, c, track_id)
    if not sigs:
        raise HTTPException(404, "unknown track")
    return await asyncio.to_thread(media.lyrics, c, sigs)


@router.websocket("/audio/levels")
async def audio_levels(ws: WebSocket):
    from ...engine.listen import SYSTEM
    await ws.accept()
    SYSTEM.subscribe()
    last = 0.0
    try:
        while True:
            stamp, bands, rms = SYSTEM.frame
            if stamp != last:
                last = stamp
                payload = (np.clip(bands, 0, 1) * 255).astype(np.uint8).tobytes() + bytes([min(255, int(rms * 255))])
                await ws.send_bytes(payload)
            elif SYSTEM.error:
                await ws.send_text(SYSTEM.error)
                await asyncio.sleep(1)
            await asyncio.sleep(1 / 45)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        SYSTEM.unsubscribe()
