import asyncio

import pytest

from karasu.net import NetError
from karasu.web.routers import library as Lib
from karasu.web.state import STATE


@pytest.fixture
def state(ctx):
    previous = STATE.ctx
    STATE.ctx = ctx
    yield ctx
    STATE.ctx = previous


class FakeDz:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def track(self, value):
        self.calls += 1
        if self.fail:
            raise NetError("offline")
        return {}


def test_links_use_the_stored_spotify_match(state):
    state.db.x("insert into dz_sp(dz_id, sp_id, checked_at) values(?,?,?)", (123, "abc", "2026-11-02"))
    state.dz = FakeDz()
    out = asyncio.run(Lib.track_links("dz:123"))
    assert out == {"spotify": "https://open.spotify.com/track/abc", "deezer": "https://www.deezer.com/track/123"}
    assert state.dz.calls == 0


def test_links_for_a_spotify_track_have_no_deezer_page(state):
    out = asyncio.run(Lib.track_links("sp:xyz"))
    assert out == {"spotify": "https://open.spotify.com/track/xyz", "deezer": None}


def test_links_fall_back_to_deezer_when_spotify_is_unreachable(state):
    state.dz = FakeDz(fail=True)
    out = asyncio.run(Lib.track_links("dz:555"))
    assert out == {"spotify": None, "deezer": "https://www.deezer.com/track/555"}


def test_links_remember_a_missing_match(state):
    state.dz = FakeDz()
    assert asyncio.run(Lib.track_links("dz:777"))["spotify"] is None
    assert asyncio.run(Lib.track_links("dz:777"))["spotify"] is None
    assert state.dz.calls == 1
