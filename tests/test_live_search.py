import time

from digger.engine import search as S
from digger.engine.backfill import rebuild_search_index


def seed(db):
    db.x("insert into dz_artists(id, name, norm, fans) values(1, 'Duster', 'duster', 120000)")
    db.x("insert into dz_artists(id, name, norm, fans) values(2, 'Dust Devils', 'dust devils', 900)")
    for tid, title, album, aid, artist, rank in [
        (11, "Inside Out", "Stratosphere", 1, "Duster", 500000),
        (12, "Constellations", "Stratosphere", 1, "Duster", 400000),
        (13, "Gold Dust", "Dusty Roads", 2, "Dust Devils", 1000),
    ]:
        db.x("insert into dz_tracks(id, title, artist_id, artist, album_id, album, duration, rank, md5) "
             "values(?,?,?,?,?,?,?,?,?)", (tid, title, aid, artist, 100 + aid, album, 200, rank, "ab" * 16))
    rebuild_search_index(db=db)


class FakeDz:
    def __init__(self, delay=0.0):
        self.delay = delay

    def search(self, kind, text, limit=25, index=0, ttl=0):
        time.sleep(self.delay)
        if kind == "artist":
            return [{"id": 1, "name": "Duster", "nb_fan": 120000}, {"id": 3, "name": "Dusters", "nb_fan": 50}]
        if kind == "track":
            return [
                {"id": 11, "title": "Inside Out", "artist": {"id": 1, "name": "Duster"},
                 "album": {"id": 101, "title": "Stratosphere"}, "duration": 200, "rank": 500000},
                {"id": 21, "title": "Inside Out (Remastered)", "artist": {"id": 1, "name": "Duster"},
                 "album": {"id": 102, "title": "Capsule Losing Contact"}, "duration": 201, "rank": 1},
                {"id": 22, "title": "Echo", "artist": {"id": 3, "name": "Dusters"},
                 "album": {"id": 103, "title": "Echoes"}, "duration": 180, "rank": 10},
            ]
        return [{"id": 104, "title": "Contemporary Movement", "artist": {"name": "Duster"}, "md5_image": "cd" * 16,
                 "nb_tracks": 12}]


def test_match_score_prefers_exact_then_prefix_then_word():
    assert S.match_score("Duster", "duster") == 3
    assert 2 < S.match_score("Dusters", "duster") < 3
    assert S.match_score("Gold Dust", "dust") == 1.5
    assert S.match_score("Stardust", "dust") == 1
    assert S.match_score("Inside Out", "duster") == 0
    assert S.match_score("Sigur Rós", "sigur ros") == 3


def test_live_puts_the_matching_artist_first_and_completes_queries(ctx):
    seed(ctx.db)
    out = S.live(ctx, "duster")
    found = [(e["kind"], e["item"].get("name") or e["item"].get("title")) for e in out["items"]]
    assert found[0] == ("artist", "Duster")
    assert ("track", "Inside Out") in found and ("album", "Stratosphere") in found
    assert out["queries"] == ["duster", "duster inside out", "duster constellations", "duster stratosphere"]
    assert out["partial"] is False


def test_library_songs_rank_first_and_self_titled_albums_are_not_doubled(ctx):
    seed(ctx.db)
    ctx.db.x("insert into dz_tracks(id, title, artist_id, artist, album_id, album, duration, rank) "
             "values(14, 'Topical Solution', 1, 'Duster', 105, 'Duster', 200, 10)")
    ctx.db.x("insert into sp_dz(sp_id, dz_id) values('sp12', 12)")
    rebuild_search_index(db=ctx.db)
    out = S.live(ctx, "duster")
    assert [e["item"]["title"] for e in out["items"] if e["kind"] == "track"][0] == "Constellations"
    assert out["queries"][:2] == ["duster", "duster constellations"]
    assert "duster duster" not in out["queries"]


def test_recent_searches_lead_the_completions(ctx):
    seed(ctx.db)
    S.record(ctx.db, "duster stratosphere full album")
    out = S.live(ctx, "dust")
    assert out["queries"][0] == "duster stratosphere full album"
    assert all(q.startswith("dust") for q in out["queries"])
    assert S.live(ctx, "")["recent"] == ["duster stratosphere full album"]


def test_live_merges_deezer_results_without_duplicates(ctx):
    seed(ctx.db)
    ctx.dz = FakeDz()
    out = S.live(ctx, "duster", remote=True)
    assert [e["item"]["name"] for e in out["items"] if e["kind"] == "artist"] == ["Duster", "Dusters"]
    tracks = [e["item"]["title"] for e in out["items"] if e["kind"] == "track"]
    assert tracks.count("Inside Out") == 1 and "Inside Out (Remastered)" not in tracks
    assert any(e["kind"] == "album" and e["item"]["title"] == "Contemporary Movement" for e in out["items"])
    assert len(out["items"]) <= 8


def test_slow_deezer_returns_library_results_first(ctx, monkeypatch):
    seed(ctx.db)
    monkeypatch.setattr(S, "REMOTE_WAIT", 0.05)
    ctx.dz = FakeDz(delay=0.4)
    out = S.live(ctx, "duster", remote=True)
    assert out["partial"] is True
    assert out["items"][0]["item"]["name"] == "Duster"
