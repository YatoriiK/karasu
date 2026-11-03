from datetime import timedelta

from digger import pipeline
from digger.lanes import Cand
from digger.publish import rolling_update, update_outcomes
from digger.resolve import original_year
from digger.util import norm_artist, now


class FakeDeezer:
    def __init__(self, tracks=None, albums=None):
        self.tracks = tracks or {}
        self.albums = albums or {}

    def track(self, dz_id, fresh=False):
        return self.tracks.get(dz_id)

    def artist_albums(self, dz_id, limit=100):
        return self.albums.get(dz_id, [])


class FakeMB:
    def __init__(self, isrc=None, search=None, artists=None, groups=None):
        self.isrc = isrc or {}
        self.search = search or []
        self.artists = artists or []
        self.groups = groups or {}

    def isrc_recordings(self, isrc):
        return self.isrc.get(isrc, [])

    def search_recordings(self, artist, title, limit=10):
        return self.search

    def search_artist(self, name, limit=5):
        return self.artists

    def release_groups(self, mbid, limit=100):
        return self.groups.get(mbid, [])


def beatles_track(isrc="GBAYE0601498"):
    return {"id": 1, "title": "Yellow Submarine (Remastered 2009)", "isrc": isrc, "release_date": "2015-12-24",
            "artist": {"id": 1, "name": "The Beatles"}, "album": {"id": 5, "title": "1"}}


def test_original_year_prefers_musicbrainz(ctx):
    ctx.dz = FakeDeezer({1: beatles_track()})
    ctx.mb = FakeMB(isrc={"GBAYE0601498": [
        {"first-release-date": "1966-08-05", "artist-credit": [{"name": "The Beatles"}]}]})
    assert original_year(ctx, 1) == (1966, "musicbrainz")
    assert original_year(ctx, 1) == (1966, "musicbrainz")


def test_original_year_falls_back_to_search_and_discogs(ctx):
    ctx.dz = FakeDeezer({1: beatles_track("NEWREMASTER01")})
    ctx.mb = FakeMB(search=[{"score": 100, "title": "Yellow Submarine", "first-release-date": "1966-08-05",
                             "artist-credit": [{"name": "The Beatles"}]},
                            {"score": 100, "title": "Yellow Submarine", "first-release-date": "1999",
                             "artist-credit": [{"name": "Someone Else"}]}])
    assert original_year(ctx, 1) == (1966, "musicbrainz")
    ctx2_year = original_year(ctx, 1, discogs_year=1965)
    assert ctx2_year == (1965, "discogs")


def test_original_year_cheap_path_and_budget(ctx):
    from digger.resolve import Budget

    calls = []

    class CountingMB(FakeMB):
        def isrc_recordings(self, isrc):
            calls.append(isrc)
            return super().isrc_recordings(isrc)

    old = {"id": 2, "title": "Old Song", "isrc": "OLD1", "release_date": "1994-05-01",
           "artist": {"id": 3, "name": "Codeine"}, "album": {"id": 4, "title": "The White Birch"}}
    reissue = beatles_track("GBAYE0601498")
    ctx.dz = FakeDeezer({1: reissue, 2: old})
    ctx.mb = CountingMB(isrc={"GBAYE0601498": [
        {"first-release-date": "1966-08-05", "artist-credit": [{"name": "The Beatles"}]}]})
    assert original_year(ctx, 2, accept_below=2006) == (1994, "deezer")
    assert calls == []
    assert original_year(ctx, 1, accept_below=2006, budget=Budget(0)) == (2015, "deezer")
    assert calls == []
    assert original_year(ctx, 1, accept_below=2006, budget=Budget(1)) == (1966, "musicbrainz")
    assert calls == ["GBAYE0601498"]


def test_fresh_verify_drops_reissue_trap(ctx):
    year = now().year
    ida = Cand(lane="fresh", source="graph", dz_id=10, title="Shrug", artist="Ida", artist_key="ida", artist_dz=77)
    ida.score = 0.9
    new = Cand(lane="fresh", source="graph", dz_id=11, title="New Song", artist="Newcomer", artist_key="newcomer",
               artist_dz=78)
    new.score = 0.8
    ctx.dz = FakeDeezer(albums={77: [{"title": "Will You Find Me"}], 78: [{"title": "Debut"}]})

    class MB(FakeMB):
        def search_artist(self, name, limit=5):
            return [{"id": name, "name": name, "score": 100, "type": "Group"}]

        def release_groups(self, mbid, limit=100):
            if mbid == "Ida":
                return [{"title": "Will You Find Me", "first-release-date": "1996-03-01"}]
            return [{"title": "Debut", "first-release-date": f"{year}-02-01"}]

    ctx.mb = MB()
    ctx.db.x("insert into dz_artists(id, name, norm) values(77, 'Ida', 'ida')")
    ctx.db.x("insert into dz_artists(id, name, norm) values(78, 'Newcomer', 'newcomer')")
    kept = pipeline.verify(ctx, [ida, new], "fresh")
    assert [c.dz_id for c in kept] == [11]


def test_archival_evidence_for_label_picks(ctx):
    cutoff = now().year - 20

    class MB(FakeMB):
        def search_artist(self, name, limit=5):
            return [{"id": name, "name": name, "score": 100, "type": "Person"}]

        def release_groups(self, mbid, limit=100):
            return [{"title": "Rewind/Remind", "first-release-date": f"{now().year - 1}-05-01"}]

    ctx.mb = MB()
    archival = Cand(lane="lost", source="labels", dz_id=1, title="Road", artist="Roger Fakhr", artist_key="roger fakhr",
                    artist_dz=5, label="HABIBI Funk Records", album="East of Any Place")
    mixed_title = Cand(lane="lost", source="labels", dz_id=2, title="Love", artist="Via Negromonte",
                       artist_key="via negromonte", artist_dz=6, label="Soundway Records Ltd",
                       album="Onda de Amor: Synthesized Brazilian Hits That Never Were (1984-94)")
    mixed_new = Cand(lane="lost", source="labels", dz_id=3, title="Rewind/Remind", artist="Momoko Gill",
                     artist_key="momoko gill", artist_dz=7, label="Strut", album="Rewind/Remind")
    mixed_tags = Cand(lane="lost", source="labels", dz_id=4, title="X", artist="Someone", artist_key="someone",
                      artist_dz=8, label="Strut", album="X", tags={"70s": 80, "funk": 100})
    weather = Cand(lane="lost", source="labels", dz_id=5, title="Like Sisters", artist="The Weather Station",
                   artist_key="weather station", artist_dz=9, label="Paradise of Bachelors", album="Loyalty")
    assert pipeline._archival(ctx, archival, cutoff)
    assert pipeline._archival(ctx, mixed_title, cutoff)
    assert not pipeline._archival(ctx, mixed_new, cutoff)
    assert not pipeline._archival(ctx, mixed_tags, cutoff)
    assert not pipeline._archival(ctx, weather, cutoff)


class FakeSpotify:
    def __init__(self, items):
        self.items = list(items)
        self.added, self.removed = [], []

    def playlist(self, pid):
        return {"id": pid}

    def playlist_items(self, pid):
        return [{"item": {"id": i, "uri": f"spotify:track:{i}"}} for i in self.items]

    def remove_items(self, pid, uris):
        self.removed += uris
        gone = {u.rsplit(":", 1)[1] for u in uris}
        self.items = [i for i in self.items if i not in gone]

    def add_items(self, pid, uris, position=None):
        self.added += uris
        self.items = [u.rsplit(":", 1)[1] for u in uris] + self.items

    def update_playlist(self, pid, description):
        return {}

    def create_playlist(self, name, description, public):
        return {"id": "PL"}


def _rec(ctx, sp_id, days_ago, outcome=None, lane="fresh"):
    stamp = (now() - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    ctx.db.x("insert into recs(lane, source, dz_id, sp_id, sp_uri, artist, artist_key, title, added_at, outcome) "
             "values(?,?,?,?,?,?,?,?,?,?)",
             (lane, "graph", 0, sp_id, f"spotify:track:{sp_id}", sp_id, sp_id, sp_id, stamp, outcome))


def test_rolling_playlist_keeps_unheard_and_removes_done(ctx):
    ctx.db.x("insert into playlists(lane, sp_id) values('fresh', 'PL')")
    _rec(ctx, "saved1", 5, "saved")
    _rec(ctx, "old1", 30)
    _rec(ctx, "unheard1", 3)
    ctx.sp = FakeSpotify(["saved1", "old1", "unheard1", "manual"])
    picks = []
    for i in range(3):
        c = Cand(lane="fresh", source="graph", dz_id=100 + i, title=f"T{i}", artist=f"N{i}", artist_key=f"n{i}")
        c.sp_id, c.sp_uri, c.score, c.reasons = f"new{i}", f"spotify:track:new{i}", 0.5, "why"
        picks.append(c)
    result = rolling_update(ctx, "fresh", picks, run_id=1, log=lambda m: None)
    assert result["added"] == 3 and result["removed"] == 2
    assert set(ctx.sp.items) == {"unheard1", "manual", "new0", "new1", "new2"}
    assert ctx.db.one("select outcome from recs where sp_id='old1'")[0] == "unheard"
    assert ctx.db.one("select count(*) from recs where sp_id like 'new%'")[0] == 3


def test_rolling_playlist_respects_max_size(ctx):
    ctx.cfg["playlists"]["max_size"] = 4
    ctx.db.x("insert into playlists(lane, sp_id) values('fresh', 'PL')")
    for i in range(4):
        _rec(ctx, f"keep{i}", 10 - i)
    ctx.sp = FakeSpotify([f"keep{i}" for i in range(4)])
    picks = []
    for i in range(2):
        c = Cand(lane="fresh", source="graph", dz_id=200 + i, title=f"T{i}", artist=f"M{i}", artist_key=f"m{i}")
        c.sp_id, c.sp_uri = f"add{i}", f"spotify:track:add{i}"
        picks.append(c)
    rolling_update(ctx, "fresh", picks, run_id=1, log=lambda m: None)
    assert len(ctx.sp.items) == 4
    assert "keep0" not in ctx.sp.items and "keep1" not in ctx.sp.items


def test_outcomes_from_saves_and_plays(ctx):
    _rec(ctx, "s", 20)
    _rec(ctx, "p", 20)
    _rec(ctx, "u", 20)
    ctx.db.x("insert into saved(track_id, added_at) values('s', '2026-01-01T00:00:00Z')")
    played = (now() - timedelta(days=16)).strftime("%Y-%m-%dT%H:%M:%SZ")
    ctx.db.x("insert into plays(track_id, played_at) values('p', ?)", (played,))
    update_outcomes(ctx)
    outcomes = {r["sp_id"]: r["outcome"] for r in ctx.db.q("select sp_id, outcome from recs")}
    assert outcomes == {"s": "saved", "p": "played_not_saved", "u": None}
