import pytest
from fastapi import HTTPException

from karasu.net import NetError
from karasu.web.routers import player as P


class Clock:
    def __init__(self):
        self.t = 0.0

    def monotonic(self):
        return self.t

    def sleep(self, s):
        self.t += s


class SleepySpotify:
    """A Spotify app on this PC that went idle: it's listed, says yes to play, and plays nothing until it's woken."""

    def __init__(self, devices=None, asleep=True, wake_by_transfer=True, item=True, play_status=204):
        self.devices = devices if devices is not None else [
            {"id": "phone", "name": "Pixel", "type": "Smartphone", "is_active": False},
            {"id": "pc", "name": P.THIS_PC, "type": "Computer", "is_active": False},
        ]
        self.asleep = asleep
        self.wake_by_transfer = wake_by_transfer
        self.play_status = play_status
        self.state = {"device": {"id": "pc"}, "is_playing": False, "item": {"uri": "spotify:track:x"}} if item else {}
        self.calls = []

    def player(self, method, path, params=None, body=None, timeout=10.0):
        self.calls.append((method, path, params, body))
        if path == "/me/player/devices":
            return {"devices": self.devices}
        if path == "/me/player" and method == "GET":
            return dict(self.state)
        if path == "/me/player" and method == "PUT":
            if self.wake_by_transfer:
                self.asleep = False
            self.state = {**self.state, "device": {"id": body["device_ids"][0]}}
            return {}
        if path == "/me/player/play":
            if self.play_status != 204:
                reason = "NO_ACTIVE_DEVICE" if self.play_status == 404 else "PREMIUM_REQUIRED"
                raise NetError("nope", self.play_status, f'{{"error":{{"reason":"{reason}"}}}}')
            if not self.asleep:
                self.state = {**self.state, "is_playing": True, "device": {"id": (params or {}).get("device_id")}}
            return {}
        if self.asleep:
            raise NetError("asleep", 404, '{"error":{"status":404,"message":"Device not found"}}')
        return {}

    def play(self, device_id=None, **kw):
        return self.player("PUT", "/me/player/play", params={"device_id": device_id} if device_id else None, body=kw)

    def player_command(self, *a, **k):
        return {}


class C:
    def __init__(self, sp):
        self.sp = sp


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(P.time, "monotonic", fake.monotonic)
    monkeypatch.setattr(P.time, "sleep", fake.sleep)
    return fake


def test_this_pc_wins_over_other_idle_devices():
    sp = SleepySpotify()
    assert P._wake(C(sp), None) == "pc"
    assert ("PUT", "/me/player", None, {"device_ids": ["pc"], "play": False}) in sp.calls


def test_a_stale_saved_device_falls_back_to_one_that_exists():
    assert P._pick_device(SleepySpotify().devices, "gone")["id"] == "pc"
    assert P._pick_device(SleepySpotify().devices, "phone")["id"] == "phone"


def test_play_on_a_sleeping_spotify_wakes_it_and_checks_it_really_plays():
    sp = SleepySpotify(wake_by_transfer=False)
    sp.devices[1]["is_active"] = True
    c = C(sp)
    with pytest.raises(HTTPException) as err:
        P._start(c, "pc", context_uri="spotify:playlist:q")
    assert err.value.status_code == 409
    sp.wake_by_transfer = True
    P._start(c, "pc", context_uri="spotify:playlist:q")
    assert sp.state["is_playing"]


def test_play_that_answers_404_tries_again_after_waking():
    sp = SleepySpotify(play_status=404)
    c = C(sp)
    with pytest.raises(HTTPException) as err:
        P._start(c, "pc", context_uri="spotify:playlist:q")
    assert err.value.status_code == 409
    assert sum(1 for call in sp.calls if call[1] == "/me/player/play") == 2


def test_no_devices_at_all_asks_the_app_to_start_spotify():
    with pytest.raises(HTTPException) as err:
        P._wake(C(SleepySpotify(devices=[])), None)
    assert err.value.status_code == 409 and err.value.detail == P.NO_DEVICE


def test_resume_after_a_long_pause():
    sp = SleepySpotify()
    assert P._resume(C(sp), None) == "pc"
    assert sp.state["is_playing"]
    with pytest.raises(HTTPException) as err:
        P._resume(C(SleepySpotify(item=False)), None)
    assert err.value.status_code == 410


def test_commands_on_a_sleeping_spotify_retry_on_the_woken_device():
    sp = SleepySpotify()
    assert P._send(C(sp), "next", None, None) == "pc"
    assert sp.calls[-1] == ("POST", "/me/player/next", {"device_id": "pc"}, None)
    quiet = SleepySpotify()
    assert P._send(C(quiet), "pause", None, None) is None
    assert not any(call[1] == "/me/player/devices" for call in quiet.calls)


def test_errors_that_arent_sleep_still_come_through():
    sp = SleepySpotify(asleep=False, play_status=403)
    with pytest.raises(NetError):
        P._start(C(sp), "pc", context_uri="spotify:playlist:q")
