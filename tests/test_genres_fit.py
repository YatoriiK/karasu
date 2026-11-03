import json
import threading

import numpy as np

from karasu.engine import fit as FT
from karasu.engine import genres as G


class FakeCorpus:
    def __init__(self, ctx, matrix, artist_keys, library):
        self.ctx = ctx
        self.lock = threading.Lock()
        self.stamp = (len(matrix), 1)
        self.ids = np.arange(1, len(matrix) + 1, dtype=np.int64)
        self.matrix = matrix.astype(np.float32)
        self.index = {int(i): n for n, i in enumerate(self.ids)}
        self.artist_keys = artist_keys
        self._library = library

    def library(self):
        return self._library


def unit(rows):
    return rows / np.linalg.norm(rows, axis=1, keepdims=True)


def corpus_with_taste(ctx, rng):
    liked = unit(rng.normal(size=(1, 32)) * 3 + rng.normal(size=(60, 32)))
    other = unit(rng.normal(size=(1, 32)) * 3 + rng.normal(size=(300, 32)))
    near = unit(liked[:1] * 3 + rng.normal(size=(40, 32)))
    matrix = np.vstack([liked, other, near])
    keys = [f"a{n % 50}" for n in range(len(matrix))]
    return FakeCorpus(ctx, matrix, keys, {i: 1.0 for i in range(1, 61)})


def test_taste_model_ranks_unseen_songs_like_the_library_higher(ctx):
    corpus = corpus_with_taste(ctx, np.random.default_rng(1))
    state = FT.train(corpus)
    scores = np.array([state["scores"][int(i)] for i in corpus.ids])
    assert state["positives"] == 60 and state["negatives"] == 340
    assert scores[360:].mean() > scores[60:360].mean() + 0.3
    assert 0.0 <= scores.min() and scores.max() <= 1.0


def test_taste_model_learns_from_thumbs_down(ctx):
    corpus = corpus_with_taste(ctx, np.random.default_rng(2))
    before = FT.train(corpus)["scores"]
    for dz_id in range(361, 381):
        ctx.db.x("insert into feedback(dz_id, kind) values(?, 'down')", (dz_id,))
    after = FT.train(corpus)["scores"]
    disliked = range(361, 381)
    assert np.mean([after[i] for i in disliked]) < np.mean([before[i] for i in disliked]) - 0.1


def test_taste_model_waits_for_enough_library(ctx):
    rng = np.random.default_rng(3)
    corpus = FakeCorpus(ctx, unit(rng.normal(size=(200, 16))), ["a"] * 200, {i: 1.0 for i in range(1, 11)})
    assert FT.train(corpus) is None


def test_families_and_word_matching():
    assert G.family_of("cloud rap") == "hiphop"
    assert G.family_of("midwest emo") == "punk"
    assert G.family_of("dream pop") == "rock"
    assert G.family_of("jazz rap") == "hiphop"
    assert G.family_of("slowcore") == "rock"
    assert G.contains("rock", "indie rock") and G.contains("punk", "post-punk")
    assert not G.contains("rock", "rockabilly") and not G.contains("rock", "rock")
    assert G.slug("r&b") == "r-and-b" and G.slug("hip hop") == "hip-hop"
    assert G.pretty("r&b") == "R&B" and G.pretty("midwest emo") == "Midwest emo"


def test_subgenres_imply_their_parent_only_within_a_family(ctx):
    ctx.db.x("insert into artist_genres(artist_id, genres, method, checked_at) values(1, ?, 'link', '2026-11-02T00:00:00Z')",
             (json.dumps({"indie rock": 4, "slowcore": 6, "rap": 1}),))
    ctx.db.x("insert into artist_genres(artist_id, genres, method, checked_at) values(2, ?, 'link', '2026-11-02T00:00:00Z')",
             (json.dumps({"jazz rap": 3}),))
    weights = G.labelled(ctx.db, {"rock", "jazz", "hip hop", "indie rock", "slowcore"})
    assert weights[1]["slowcore"] == 1.0 and abs(weights[1]["rock"] - 0.6 * 4 / 6) < 1e-6
    assert "hip hop" not in weights[1]
    assert "jazz" not in weights[2]


def test_track_genres_prefer_tags_then_sound_guesses(ctx):
    ctx.db.x("insert into artist_genres(artist_id, genres, method, checked_at) values(1, ?, 'link', '')",
             (json.dumps({"emo": 2, "midwest emo": 5}),))
    ctx.db.x("insert into artist_genres(artist_id, genres, method, checked_at) values(2, '{}', 'none', '')")
    ctx.db.x("insert into artist_genre_guess(artist_id, genres) values(2, ?)", (json.dumps(["shoegaze"]),))
    out = G.track_genres(ctx.db, [1, 2, 3, None])
    assert out == {1: ["Midwest emo", "Emo"], 2: ["Shoegaze"]}


class FakeMB:
    def __init__(self):
        self.calls = []

    def url_artists(self, urls):
        self.calls.append(("url", len(urls)))
        return [{"resource": "https://www.deezer.com/artist/11", "relations": [{"artist": {"id": "mb-11"}}]}]

    def artist(self, mbid, inc="genres+tags"):
        self.calls.append(("artist", mbid))
        return {"genres": [{"name": "Slowcore", "count": 3}], "tags": [], "area": {"name": "United States"},
                "begin-area": {"name": "Sacramento"}}

    def search_artist(self, name, limit=5):
        self.calls.append(("search", name))
        return [{"id": "mb-12", "name": name, "score": 100, "tags": [{"name": "shoegaze", "count": 2},
                                                                     {"name": "seen live", "count": 9}]}]

    def genres(self, offset=0, limit=100):
        return {"genre-count": 2, "genres": [{"name": "shoegaze"}, {"name": "slowcore"}]}


class FakeJob:
    def __init__(self, ctx):
        self.ctx = ctx

    def progress(self, *args, **kwargs):
        pass


def test_learn_matches_by_link_then_by_name(ctx):
    G._GENRE_NAMES.clear()
    ctx.mb = FakeMB()
    for dz_id, artist in ((101, 11), (102, 12)):
        ctx.db.x("insert into dz_tracks(id, title, artist_id, artist) values(?, 'Song', ?, ?)",
                 (dz_id, artist, f"Band {artist}"))
        ctx.db.x("insert into embeddings(dz_id, vec, model) values(?, ?, 'm')", (dz_id, b"\x00" * 8))
    out = G.learn(FakeJob(ctx))
    rows = {r["artist_id"]: dict(r) for r in ctx.db.q("select * from artist_genres")}
    assert out == {"artists": 2, "tagged": 2}
    assert rows[11]["method"] == "link" and json.loads(rows[11]["genres"]) == {"slowcore": 3}
    assert rows[11]["origin"] == "Sacramento"
    assert rows[12]["method"] == "search" and json.loads(rows[12]["genres"]) == {"shoegaze": 2}
    assert G.learn(FakeJob(ctx)) == {"artists": 0}
    G._GENRE_NAMES.clear()
