import json

import numpy as np
import pytest

from karasu.audio import model_name
from karasu.engine import daily as D
from karasu.engine import facets as F
from karasu.engine.corpus import Corpus
from karasu.engine.insight import compare, export_profile, profile, stats
from karasu.util import norm_artist, now_iso

N_LIB = 60
N_NEW = 240


def build_world(ctx, seed=0):
    rng = np.random.default_rng(seed)
    db = ctx.db
    model = model_name(ctx.cfg)
    centers = rng.normal(size=(4, 512))
    with db.tx():
        for i in range(1, N_LIB + N_NEW + 1):
            artist = 1000 + i // 3
            name = f"Artist {artist}"
            year = 1965 + (i * 7) % 60
            v = centers[i % 4] + rng.normal(scale=0.6, size=512)
            v = (v / np.linalg.norm(v)).astype(np.float32)
            fans = 300 if artist % 5 == 0 else 1500 if artist % 5 == 1 else 40000
            db.x("insert into dz_tracks(id, title, artist_id, artist, album_id, album, release_date, md5) "
                 "values(?,?,?,?,?,?,?,?)",
                 (i, f"Song {i}", artist, name, 5000 + i // 3, f"Album {artist}", f"{year}-01-01", f"md5{i}"))
            db.x("insert or ignore into dz_artists(id, name, norm, fans) values(?,?,?,?)",
                 (artist, name, norm_artist(name), fans))
            db.x("insert into embeddings(dz_id, vec, model) values(?,?,?)", (i, v.tobytes(), model))
            db.x("insert into facets(dz_id, vec, version) values(?,?,?)",
                 (i, rng.normal(size=len(F.IDS)).astype(np.float32).tobytes(), F.VERSION))
            if i <= N_LIB:
                db.x("insert into sp_dz(sp_id, dz_id) values(?,?)", (f"sp{i}", i))
                db.x("insert into seeds(kind, ref, weight) values('track:top_long', ?, ?)", (f"sp{i}", 1.0 + i % 3))
    corpus = Corpus(ctx)
    corpus.refresh(force=True)
    return corpus


@pytest.fixture
def world(ctx):
    return build_world(ctx)


def test_song_of_day_is_stable_and_another_moves_on(ctx, world):
    first = D.song_of_day(ctx, world, "2026-11-01")
    assert first["song"] > N_LIB
    assert D.song_of_day(ctx, world, "2026-11-01")["song"] == first["song"]
    second = D.song_of_day(ctx, world, "2026-11-01", another=True)
    assert second["song"] != first["song"]
    assert second["song_history"] == [first["song"]]


def test_daily_picks_are_new_stable_and_varied(ctx, world):
    out = D.build(ctx, world, "2026-11-01")
    known_artists = world.known_artist_ids()
    assert out["artist"]["dz_id"] not in known_artists
    assert all(t["artist"]["dz_id"] == out["artist"]["dz_id"] for t in out["artist"]["tracks"])
    assert out["album"]["tracks"] and len(out["album"]["tracks"]) >= 3
    assert out["album"]["artist_id"] != out["artist"]["dz_id"]
    assert out["gem"]["popularity"]["fans"] < 2000
    mix = out["mix"]["tracks"]
    assert out["mix"]["known"] > 0 and out["mix"]["new"] > 0
    artists = [t["artist"]["dz_id"] for t in mix]
    assert all(a != b for a, b in zip(artists, artists[1:]))
    daily_ids = {t["id"] for t in out["album"]["tracks"]} | {out["gem"]["id"]}
    assert not daily_ids & {t["id"] for t in mix}
    again = D.build(ctx, world, "2026-11-01")
    assert again["artist"]["dz_id"] == out["artist"]["dz_id"]
    assert [t["id"] for t in again["mix"]["tracks"]] == [t["id"] for t in mix]
    assert out["challenge"]["kind"] in D.CHALLENGES
    assert 0 <= out["challenge"]["progress"] <= out["challenge"]["goal"]


def test_next_day_avoids_yesterdays_artist(ctx, world):
    day1 = D.ensure_picks(ctx, world, "2026-11-01")
    day2 = D.ensure_picks(ctx, world, "2026-11-02")
    assert day1["artist_id"] != day2["artist_id"]
    assert day1["challenge"]["kind"] != day2["challenge"]["kind"]


def test_challenge_counts_todays_plays_and_streak(ctx, world):
    date = D.today()
    picks = D.ensure_picks(ctx, world, date)
    picks["challenge"] = {"kind": "underground"}
    D._save(ctx.db, date, picks)
    status = D.challenge(ctx, world, date)
    assert status["progress"] == 0 and not status["done"]
    underground = [r[0] for r in ctx.db.q(
        "select t.id from dz_tracks t join dz_artists a on a.id = t.artist_id where a.fans < 1000 limit 3")]
    for n, dz_id in enumerate(underground):
        ctx.db.x("insert into listen_events(source, dz_id, artist, title, played_at, ms_played, skipped) "
                 "values('app', ?, 'x', 'y', ?, 30000, 0)", (dz_id, now_iso()[:-1] + f".{n}Z"))
    status = D.challenge(ctx, world, date)
    assert status["progress"] == 3 and status["done"]
    assert status["streak"] == 1
    assert D._load(ctx.db, date)["challenge"]["done"] is True


def test_profile_traits_are_bounded(ctx, world):
    p = profile(ctx, world)
    for key, value in p["traits"].items():
        assert 0 <= value <= 100, key
    assert p["range_genres"] >= 1
    assert p["personality"]["name"].startswith("The ")
    assert len(p["map"]["points"]) == N_LIB
    labelled = [m for m in p["map"]["modes"] if m["label"]]
    assert labelled


def test_export_and_compare_with_self(ctx, world):
    mine = export_profile(ctx, world)
    json.dumps(mine)
    assert compare(ctx, world, mine)["score"] >= 98
    rng = np.random.default_rng(7)
    other = dict(mine)
    other["centroid"] = [float(x) for x in rng.normal(size=len(mine["centroid"]))]
    other["genres"] = [{"label": g["label"], "score": -g["score"]} for g in mine["genres"]]
    other["genres"][0]["score"] = 1.0
    assert compare(ctx, world, other)["score"] < 50


def test_stats_count_events(ctx, world):
    for n in range(5):
        ctx.db.x("insert into listen_events(source, dz_id, artist, title, played_at, ms_played, skipped) "
                 "values('app', ?, ?, 't', ?, 30000, 0)", (N_LIB + n + 1, f"Artist {n}", now_iso()[:-1] + f".{n}Z"))
    s = stats(ctx, "week")
    assert s["plays"] == 5
    assert s["artists"] == 5
