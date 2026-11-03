import asyncio

import pytest
from fastapi import HTTPException

from karasu.sources.discogs import Discogs
from karasu.sources.lastfm import LastFM
from karasu.web.routers import system as R
from karasu.web.state import STATE

LASTFM_KEY = "0123456789abcdef0123456789abcdef"


@pytest.fixture
def state(ctx, monkeypatch):
    ctx.net = None
    ctx.lfm = LastFM(None, "")
    ctx.dg = Discogs(None, "")
    previous = STATE.ctx
    STATE.ctx = ctx
    yield ctx
    STATE.ctx = previous


def put(service, value):
    return asyncio.run(R.put_key(service, R.Key(value=value)))


def test_a_working_key_is_saved_and_switched_on(state, monkeypatch):
    monkeypatch.setattr(R, "_key_works", lambda c, service, value: True)
    assert put("lastfm", f"  {LASTFM_KEY} ") == {"lastfm": True, "discogs": False}
    assert state.lfm.key == LASTFM_KEY and state.cfg["lastfm"]["api_key"] == LASTFM_KEY
    assert state.db.settings()["lastfm.api_key"] == f'"{LASTFM_KEY}"'
    assert put("discogs", "a" * 40)["discogs"] is True


def test_bad_or_rejected_keys_are_not_saved(state, monkeypatch):
    checks = []
    monkeypatch.setattr(R, "_key_works", lambda c, service, value: checks.append(value) or False)
    with pytest.raises(HTTPException) as bad:
        put("lastfm", "not a key")
    assert bad.value.status_code == 400 and "doesn't look like" in bad.value.detail and checks == []
    with pytest.raises(HTTPException) as rejected:
        put("lastfm", LASTFM_KEY)
    assert "didn't accept" in rejected.value.detail
    monkeypatch.setattr(R, "_key_works", lambda c, service, value: None)
    with pytest.raises(HTTPException) as offline:
        put("discogs", "b" * 40)
    assert offline.value.status_code == 502
    assert "lastfm.api_key" not in state.db.settings() and not state.lfm.enabled
    with pytest.raises(HTTPException) as unknown:
        put("spotify", "x")
    assert unknown.value.status_code == 404


def test_an_empty_value_removes_the_key(state, monkeypatch):
    monkeypatch.setattr(R, "_key_works", lambda c, service, value: True)
    put("lastfm", LASTFM_KEY)
    assert put("lastfm", "") == {"lastfm": False, "discogs": False}
    assert state.cfg["lastfm"]["api_key"] == ""
