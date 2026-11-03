import contextlib

import pytest
from fastapi import HTTPException

from karasu.engine import setup as S
from karasu.engine.corpus import Corpus
from karasu.sources.spotify import Spotify
from karasu.web.routers import setup as R
from karasu.web.state import STATE

CLIENT = "0123456789abcdef0123456789abcdef"


class FakeJobs:
    def __init__(self):
        self.calls = []

    def submit(self, kind, fn, params=None, key=None, label=None):
        self.calls.append((kind, key, label))
        return f"job{len(self.calls)}"

    def get(self, job_id):
        return {"id": job_id, "status": "running", "stage": "Learning your taste", "done": 1, "total": 3}


class FakeDeezer:
    def __init__(self, artists=(), chart=(), top=None):
        self.artists = list(artists)
        self.chart = list(chart)
        self.top = top or {}

    def search_artist(self, name, limit=10):
        return self.artists

    def chart_artists(self, limit=50):
        return self.chart

    def artist_top(self, artist_id, limit=10):
        return self.top.get(artist_id, [])


def deezer_artist(aid, name, fans=1000):
    md5 = f"{aid:032x}"
    return {"id": aid, "name": name, "nb_fan": fans,
            "picture_small": f"https://e-cdns-images.dzcdn.net/images/artist/{md5}/56x56-000000-80-0-0.jpg"}


@pytest.fixture
def state(ctx, monkeypatch):
    ctx.net = None
    ctx.sp = Spotify(None, "", 8888)
    ctx.dz = FakeDeezer()
    monkeypatch.setattr(Spotify, "_saved", lambda self: None)
    previous = (STATE.ctx, STATE.jobs, STATE.corpus)
    STATE.ctx, STATE.jobs, STATE.corpus = ctx, FakeJobs(), None
    yield ctx
    STATE.ctx, STATE.jobs, STATE.corpus = previous


def test_login_only_counts_for_the_same_client(monkeypatch):
    sp = Spotify(None, CLIENT)
    monkeypatch.setattr(Spotify, "_saved", lambda self: {"client_id": "f" * 32, "refresh_token": "x"})
    assert not sp.has_login()
    monkeypatch.setattr(Spotify, "_saved", lambda self: {"client_id": CLIENT, "refresh_token": "x"})
    assert sp.has_login()
    monkeypatch.setattr(Spotify, "_saved", lambda self: None)
    assert not sp.has_login()


def test_fresh_install_needs_setup_until_finished(state):
    first = R.setup_state()
    assert first["needed"] and not first["done"]
    assert first["redirect_uri"] == "http://127.0.0.1:8888/callback"
    assert first["picks"] == [] and first["job"] is None
    done = R.finish(R.Finish(path="skip", history_requested=True))
    assert done["done"] and not done["needed"]
    assert done["path"] == "skip" and done["history_requested"]


def test_existing_library_never_needs_setup(state):
    state.db.x("insert into seeds(kind, ref, weight) values('track:saved', 'abc', 1.0)")
    assert not R.setup_state()["needed"]


def test_client_id_is_checked_saved_and_applied(state):
    for bad in ("", "abc", "g" * 32, CLIENT + "0"):
        with pytest.raises(HTTPException) as err:
            R.set_client_id(R.ClientId(client_id=bad))
        assert err.value.status_code == 400
    out = R.set_client_id(R.ClientId(client_id=f"  {CLIENT.upper()} "))
    assert out["client_id"] == CLIENT and out["path"] == "premium"
    assert out["spotify"]["configured"] and not out["spotify"]["logged_in"]
    assert state.sp.client_id == CLIENT
    assert state.cfg["spotify"]["client_id"] == CLIENT
    assert state.db.settings()["spotify.client_id"] == f'"{CLIENT}"'


def test_sync_requires_a_login(state):
    with pytest.raises(HTTPException) as err:
        R.setup_sync()
    assert err.value.status_code == 400
    assert STATE.jobs.calls == []


def test_artist_search_stores_artists_with_pictures(state):
    state.dz = FakeDeezer(artists=[deezer_artist(11, "Mitski", 900000), deezer_artist(12, "Mitski Tribute")],
                          chart=[deezer_artist(13, "Charting")])
    found = R.setup_artists("mitski")
    assert [a["dz_id"] for a in found] == [11, 12]
    assert found[0]["name"] == "Mitski" and found[0]["fans"] == 900000
    assert found[0]["art"] is not None
    assert [a["dz_id"] for a in R.setup_artists("  ")] == [13]


def test_picks_are_validated_and_start_learning(state):
    R.setup_artists("")
    with pytest.raises(HTTPException):
        R.setup_picks(R.Picks(artist_ids=[1, 2]))
    state.dz = FakeDeezer(artists=[deezer_artist(i, f"Artist {i}") for i in (1, 2, 3, 4)])
    R.setup_artists("artist")
    with pytest.raises(HTTPException):
        R.setup_picks(R.Picks(artist_ids=[1, 2, 99]))
    out = R.setup_picks(R.Picks(artist_ids=[3, 1, 2, 1]))
    assert out["job"] == "job1"
    assert STATE.jobs.calls == [("setup", "setup:picks", "Learning your taste")]
    assert S.picks(state.db) == [3, 1, 2]
    st = R.setup_state()
    assert [a["dz_id"] for a in st["picks"]] == [3, 1, 2]
    assert st["path"] == "free" and st["job"]["stage"] == "Learning your taste"


class FakeJob:
    def __init__(self, ctx):
        self.ctx = ctx
        self.cancelled = False
        self.stages = []

    def progress(self, stage=None, done=None, total=None, force=False):
        if stage:
            self.stages.append(stage)

    def gpu(self):
        return contextlib.nullcontext()


def test_learning_picks_turns_top_songs_into_taste(state, monkeypatch):
    from karasu.engine import backfill, discover

    def song(tid, aid):
        return {"id": tid, "title": f"Song {tid}", "preview": f"https://cdn/{tid}.mp3", "duration": 200,
                "artist": {"id": aid, "name": f"Artist {aid}"}, "album": {"id": tid * 10, "title": "LP"}}

    state.dz = FakeDeezer(top={1: [song(101, 1), song(102, 1)], 2: [song(201, 2)], 3: []})
    S.save_picks(state.db, [1, 2, 3])
    embedded = []
    ran = []

    def fake_first_run(jc, steps=None):
        ran.extend(steps or [])
        return {}

    monkeypatch.setattr(S, "_embed", lambda jc, items, stage: embedded.extend(items) or len(items))
    monkeypatch.setattr(discover, "deepen", lambda jc, artist_ids, limit_artists: {"added": 7, "seen": artist_ids})
    monkeypatch.setattr(backfill, "first_run", fake_first_run)
    out = S.learn_picks(FakeJob(state))
    assert out == {"artists": 3, "songs": 3, "new": 7}
    assert ran == ["facets", "index", "covers"]
    assert [i for i, _ in embedded] == [101, 102, 201]
    weights = dict(state.db.q("select ref, weight from seeds where kind='pick:track'"))
    assert set(weights) == {"101", "102", "201"} and weights["101"] > weights["102"]
    corpus = Corpus(state)
    assert set(corpus.library()) == {101, 102, 201}
    assert {1, 2, 3} <= corpus.known_artist_ids()
    assert {101, 102, 201} <= corpus.known_ids()
    assert S.has_library(state.db)
