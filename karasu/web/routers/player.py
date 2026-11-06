import asyncio
import socket
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...engine.setup import synced
from ...net import NetError
from ...sources.spotify import AuthError
from ...util import now_iso
from ..state import STATE, ctx
from .library import known_spotify_id, song_ids, spotify_id_for, spotify_ids_for
from .setup import start_sync

router = APIRouter(prefix="/api")
_login = {"running": False, "error": None}
_queue = {"gen": 0, "lock": threading.Lock()}
QUEUE_NAME = "Karasu"
QUEUE_NOTE = "Karasu plays your picks from here and refills it on its own."
NO_DEVICE = "No Spotify device found. Open Spotify on this PC or your phone."
ASLEEP = "Spotify didn't start playing. Press play in Spotify once, then try again."
THIS_PC = socket.gethostname().lower()


@router.get("/spotify/status")
def status():
    c = ctx()
    logged = c.sp.configured and c.sp.has_login()
    return {
        "configured": c.sp.configured,
        "logged_in": logged,
        "missing_scopes": c.sp.missing_scopes() if logged else [],
        "login_running": _login["running"],
        "login_error": _login["error"],
        "login_url": c.sp.auth_url if _login["running"] else None,
        "user": c.db.meta("spotify_user", {}),
    }


@router.post("/spotify/login")
def login():
    c = ctx()
    if not c.sp.configured:
        raise HTTPException(400, "Add your Spotify Client ID first. Settings → Connections → Set up walks you through it.")
    if _login["running"]:
        return {"started": False, "running": True}

    def run():
        _login.update(running=True, error=None)
        try:
            me = c.sp.login(open_browser=True)
            c.db.set_meta("spotify_user", {"id": me.get("id"), "name": me.get("display_name"),
                                           "product": me.get("product")})
            if not synced(c.db):
                start_sync(c)
        except Exception as exc:
            _login["error"] = str(exc)
        finally:
            STATE.invalidate("me")
            _login["running"] = False

    threading.Thread(target=run, daemon=True).start()
    return {"started": True}


def _sp_call(fn):
    try:
        return fn()
    except AuthError as exc:
        raise HTTPException(401, str(exc))
    except NetError as exc:
        status_code = exc.status or 502
        body = exc.body or ""
        if "NO_ACTIVE_DEVICE" in body or (status_code == 404 and "device" in body.lower()):
            raise HTTPException(409, "No active Spotify device. Open Spotify on this PC or your phone.")
        if "PREMIUM_REQUIRED" in body:
            raise HTTPException(403, "Spotify says this needs Premium.")
        if status_code == 403 and "scope" in body.lower():
            raise HTTPException(403, "Reconnect Spotify in Settings to allow playback control.")
        raise HTTPException(status_code if 400 <= status_code < 600 else 502, str(exc))


def _normalize(state):
    if not state:
        return {"active": False}
    item = state.get("item") or {}
    album = item.get("album") or {}
    images = sorted(album.get("images") or [], key=lambda i: -(i.get("width") or 0))
    device = state.get("device") or {}
    return {
        "active": True,
        "is_playing": bool(state.get("is_playing")),
        "progress_ms": state.get("progress_ms"),
        "shuffle": state.get("shuffle_state"),
        "repeat": state.get("repeat_state"),
        "device": {"id": device.get("id"), "name": device.get("name"), "type": device.get("type"),
                   "volume": device.get("volume_percent")},
        "track": {
            "sp_id": item.get("id"), "linked_id": (item.get("linked_from") or {}).get("id"),
            "uri": item.get("uri"), "title": item.get("name"),
            "artist": ", ".join(a.get("name") for a in item.get("artists") or []),
            "album": album.get("name"), "duration_ms": item.get("duration_ms"),
            "image": images[0]["url"] if images else None,
        } if item else None,
    }


@router.get("/player/spotify/state")
async def state():
    c = ctx()
    data = await asyncio.to_thread(_sp_call, c.sp.player_state)
    return _normalize(data)


@router.get("/player/spotify/devices")
async def devices():
    c = ctx()
    return {"devices": await asyncio.to_thread(_sp_call, c.sp.devices)}


class PlayBody(BaseModel):
    track_ids: list[str] = []
    offset: int = 0
    position_ms: int | None = None
    device_id: str | None = None
    context: str | None = None
    shuffle: bool | None = None


def _context_uri(c, context):
    if not context:
        return None
    if context.startswith("sp:") and c.db.one("select 1 from sp_playlist_items where playlist_id=? limit 1", (context[3:],)):
        return f"spotify:playlist:{context[3:]}"
    return None


def _asleep(exc):
    # A Spotify app that sat idle stays in the device list but stops listening: commands get 404, 502 or nothing.
    return exc.status in (None, 404, 500, 502, 503) or "NO_ACTIVE_DEVICE" in (exc.body or "")


def _now(c):
    try:
        return c.sp.player("GET", "/me/player", params={"additional_types": "track"}, timeout=6.0) or {}
    except NetError:
        return {}


def _wait(c, test, seconds):
    end = time.monotonic() + seconds
    while True:
        state = _now(c)
        if state and test(state):
            return state
        if time.monotonic() >= end:
            return None
        time.sleep(0.4)


def _on(device_id):
    return lambda s: (s.get("device") or {}).get("id") == device_id


def _pick_device(devices, wanted):
    usable = [d for d in devices if d.get("id") and not d.get("is_restricted")]

    def computer(d):
        return (d.get("type") or "").lower() == "computer"

    for test in (lambda d: d["id"] == wanted, lambda d: d.get("is_active"),
                 lambda d: computer(d) and (d.get("name") or "").lower() == THIS_PC, computer):
        found = next((d for d in usable if test(d)), None)
        if found:
            return found
    return usable[0] if usable else None


def _transfer(c, device_id):
    try:
        c.sp.player("PUT", "/me/player", body={"device_ids": [device_id], "play": False})
    except NetError as exc:
        if not _asleep(exc):
            raise


def _wake(c, wanted=None):
    devices = c.sp.player("GET", "/me/player/devices", timeout=6.0).get("devices") or []
    device = _pick_device(devices, wanted)
    if not device:
        raise HTTPException(409, NO_DEVICE)
    if not device.get("is_active"):
        _transfer(c, device["id"])
        _wait(c, _on(device["id"]), 2.5)
    return device["id"]


def _start(c, device_id, **play):
    # Spotify can say yes and then play nothing, so only a playing state on that device counts.
    playing = lambda s: _on(device_id)(s) and s.get("is_playing")
    for attempt in range(2):
        try:
            c.sp.play(device_id=device_id, **play)
        except NetError as exc:
            if not _asleep(exc):
                raise
        else:
            if _wait(c, playing, 3.0):
                return
        if attempt == 0:
            _transfer(c, device_id)
            time.sleep(0.6)
    raise HTTPException(409, ASLEEP)


def _window(c, track_ids, offset):
    offset = min(max(0, offset), max(len(track_ids) - 1, 0))
    lo = max(0, offset - 20)
    ids = track_ids[lo:lo + 100]
    slots = [known_spotify_id(c, tid) for tid in ids]
    lookups = 0
    for k in range(offset - lo, len(ids)):
        known, sp_id = slots[k]
        if not known and lookups < 8:
            lookups += 1
            try:
                sp_id = spotify_id_for(c, ids[k])
            except NetError:
                sp_id = None
            slots[k] = (True, sp_id)
        if sp_id:
            return ids, slots, k
    return ids, slots, None


def _fill_queue(c, uris):
    pid = c.db.meta("sp_queue_playlist", None)
    if pid:
        if c.sp.replace_items(pid, uris) is not None:
            return pid
        c.sp.player_command("PUT", "/me/library", params={"uris": f"spotify:playlist:{pid}"})
        if c.sp.replace_items(pid, uris) is not None:
            return pid
    pid = c.sp.create_playlist(QUEUE_NAME, QUEUE_NOTE, public=False)["id"]
    c.db.set_meta("sp_queue_playlist", pid)
    c.sp.replace_items(pid, uris)
    return pid


def _complete_queue(c, gen, pid, ids, slots, first):
    present = [bool(sp_id) for _, sp_id in slots]
    for k in range(first + 1, len(ids)):
        if slots[k][0]:
            continue
        if _queue["gen"] != gen:
            return
        try:
            sp_id = spotify_id_for(c, ids[k])
        except NetError:
            return
        if not sp_id:
            continue
        with _queue["lock"]:
            if _queue["gen"] != gen:
                return
            try:
                c.sp.add_items(pid, [f"spotify:track:{sp_id}"], position=sum(present[:k]))
            except NetError:
                return
            present[k] = True


def _shuffle(c, state, device_id):
    if state is None:
        return
    params = {"state": "true" if state else "false"}
    if device_id:
        params["device_id"] = device_id
    try:
        c.sp.player_command("PUT", "/me/player/shuffle", params=params)
    except NetError:
        pass


@router.post("/player/spotify/play")
async def play(body: PlayBody):
    c = ctx()

    def go():
        device_id = _wake(c, body.device_id)
        context_uri = _context_uri(c, body.context)
        if context_uri:
            try:
                _start(c, device_id, context_uri=context_uri, offset=max(0, body.offset), position_ms=body.position_ms)
                _shuffle(c, body.shuffle, device_id)
                return {"ok": True, "matched": None, "context": context_uri, "device_id": device_id}
            except NetError as exc:
                if exc.status not in (400, 403):
                    raise
        ids, slots, first = _window(c, body.track_ids, body.offset)
        if first is None:
            raise HTTPException(404, "None of these songs are on Spotify")
        uris = [f"spotify:track:{sp_id}" for _, sp_id in slots if sp_id]
        with _queue["lock"]:
            _queue["gen"] += 1
            gen = _queue["gen"]
            pid = _fill_queue(c, uris)
        queue_uri = f"spotify:playlist:{pid}"
        _start(c, device_id, context_uri=queue_uri, offset=sum(1 for _, sp_id in slots[:first] if sp_id),
               position_ms=body.position_ms)
        _shuffle(c, body.shuffle, device_id)
        if any(not known for known, _ in slots[first + 1:]):
            threading.Thread(target=_complete_queue, args=(c, gen, pid, ids, slots, first), daemon=True).start()
        return {"ok": True, "matched": len(uris), "context": queue_uri, "device_id": device_id}

    return await asyncio.to_thread(_sp_call, go)


class Command(BaseModel):
    action: str
    value: str | int | float | bool | None = None
    device_id: str | None = None


ROUTES = {
    "pause": ("PUT", "/me/player/pause", None),
    "next": ("POST", "/me/player/next", None),
    "previous": ("POST", "/me/player/previous", None),
    "seek": ("PUT", "/me/player/seek", lambda v: {"position_ms": int(v)}),
    "volume": ("PUT", "/me/player/volume", lambda v: {"volume_percent": int(v)}),
    "shuffle": ("PUT", "/me/player/shuffle", lambda v: {"state": str(bool(v)).lower()}),
    "repeat": ("PUT", "/me/player/repeat", lambda v: {"state": str(v)}),
    "queue": ("POST", "/me/player/queue", lambda uri: {"uri": uri}),
}


def _resume(c, wanted):
    state = _now(c)
    if not state.get("item"):
        # After a long pause Spotify forgets what was playing, so there's nothing left to resume.
        raise HTTPException(410, "Nothing to resume")
    device_id = _wake(c, wanted or (state.get("device") or {}).get("id"))
    if state.get("is_playing") and _on(device_id)(state):
        return device_id
    _start(c, device_id)
    return device_id


def _send(c, action, value, wanted):
    method, path, params = ROUTES[action]
    params = params(value) if params else {}
    try:
        c.sp.player(method, path, params=params or None)
        return None
    except NetError as exc:
        if not _asleep(exc):
            raise
        if action == "pause":
            return None
    device_id = _wake(c, wanted)
    c.sp.player(method, path, params={**params, "device_id": device_id})
    return device_id


@router.post("/player/spotify/command")
async def command(body: Command):
    c = ctx()
    if body.action == "transfer":
        await asyncio.to_thread(_sp_call, lambda: c.sp.player("PUT", "/me/player",
                                                              body={"device_ids": [str(body.value)], "play": True}))
        return {"ok": True}
    if body.action == "resume":
        return {"ok": True, "device_id": await asyncio.to_thread(_sp_call, lambda: _resume(c, body.device_id))}
    if body.action not in ROUTES:
        raise HTTPException(400, "unknown action")
    value = body.value
    if body.action == "queue":
        sp_ids = await asyncio.to_thread(spotify_ids_for, c, [str(value)])
        if not sp_ids:
            raise HTTPException(404, "Not on Spotify")
        value = f"spotify:track:{sp_ids[0]}"
    return {"ok": True, "device_id": await asyncio.to_thread(_sp_call, lambda: _send(c, body.action, value, body.device_id))}


class SaveBody(BaseModel):
    id: str


@router.post("/library/save")
async def save(body: SaveBody):
    c = ctx()

    def go():
        sp_ids = spotify_ids_for(c, [body.id])
        if not sp_ids:
            raise HTTPException(404, "This song isn't on Spotify")
        c.sp.save_tracks([f"spotify:track:{sp_ids[0]}"])
        c.db.x("insert or replace into saved(track_id, added_at) values(?, ?)", (sp_ids[0], now_iso()))
        return {"ok": True, "sp_id": sp_ids[0]}

    return await asyncio.to_thread(_sp_call, go)


@router.post("/library/unsave")
async def unsave(body: SaveBody):
    c = ctx()

    def go():
        sp_ids = spotify_ids_for(c, [body.id])
        if not sp_ids:
            raise HTTPException(404, "This song isn't on Spotify")
        # The like may sit on another copy of the song, so take it off every copy that has one.
        others = {s for s in song_ids(c.db, body.id)[0] if c.db.one("select 1 from saved where track_id=?", (s,))}
        gone = [sp_ids[0], *sorted(others - {sp_ids[0]})]
        c.sp.unsave_tracks([f"spotify:track:{s}" for s in gone])
        for s in gone:
            c.db.x("delete from saved where track_id=?", (s,))
        return {"ok": True, "sp_id": sp_ids[0]}

    return await asyncio.to_thread(_sp_call, go)
