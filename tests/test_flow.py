import numpy as np

from digger.engine.flow import adjacent_same_artist, curve, order, tempo_gap
from digger.engine.home import split_reason


def test_curves():
    assert np.all(np.diff(curve("build", 10)) > 0)
    assert np.all(np.diff(curve("winddown", 10)) < 0)
    assert np.allclose(curve("steady", 5), curve("steady", 5)[0])
    assert curve("wave", 20).max() > curve("wave", 20).min()


def test_tempo_gap_half_double():
    assert tempo_gap(120, 60) == 0
    assert tempo_gap(90, 180) == 0
    assert tempo_gap(100, 130) > 0.5
    assert tempo_gap(None, 100) > 0


def test_order_avoids_same_artist_and_follows_build():
    rng = np.random.default_rng(0)
    ids = list(range(20))
    artists = {i: i % 4 for i in ids}
    energy = {i: float(rng.uniform(0.1, 0.9)) for i in ids}
    tempo = {i: float(rng.uniform(80, 160)) for i in ids}
    vecs = {i: (lambda v: v / np.linalg.norm(v))(rng.normal(size=16)) for i in ids}
    seq = order(ids, energy, tempo, vecs, artists, shape="build")
    assert sorted(seq) == ids
    assert adjacent_same_artist(seq, artists) == 0
    first, last = np.mean([energy[i] for i in seq[:5]]), np.mean([energy[i] for i in seq[-5:]])
    assert last > first


def test_split_reason():
    parts = split_reason("sounds like LUCKI - 60 mgs · similar to FourFive (via Votabias) · 2.8k Deezer fans · 1977?")
    assert [p["kind"] for p in parts] == ["sound", "graph", "popularity", "era"]
    assert parts[0]["text"] == "Sounds like LUCKI - 60 mgs"
    assert parts[3]["text"] == "From 1977"
    assert split_reason("") == []
