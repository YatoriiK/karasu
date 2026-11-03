from datetime import timedelta

import numpy as np

from digger import gates
from digger.lanes import Cand, classify, label_matches, map_styles, _discogs_title
from digger.score import compute
from digger.select import select
from digger.taste import Taste
from digger.util import norm_artist, now


def cand(lane="fresh", source="graph", dz_id=1, title="Song", artist="Artist", **kw):
    return Cand(lane=lane, source=source, dz_id=dz_id, title=title, artist=artist, artist_key=norm_artist(artist), **kw)


def known(**kw):
    base = {"keys": set(), "artist_norms": set(), "blocked_artists": set(), "rec_artists": set(), "artist_dz": set(),
            "track_ids": set()}
    base.update(kw)
    return base


def test_classify_lanes(ctx):
    year = now().year
    recent = (now() - timedelta(days=30)).strftime("%Y-%m-%d")
    stale = (now() - timedelta(days=900)).strftime("%Y-%m-%d")
    assert classify(ctx.cfg, year - 1, recent) == "fresh"
    assert classify(ctx.cfg, year - 1, stale) is None
    assert classify(ctx.cfg, 1979, recent) == "lost"
    assert classify(ctx.cfg, year - 10, recent) is None
    assert classify(ctx.cfg, None, recent) is None
    assert classify(ctx.cfg, year - 1, recent, lanes=("lost",)) is None


def test_gates_filter_and_dedupe(ctx):
    cands = [
        cand(dz_id=1, artist="Known Band", listeners=500),
        cand(dz_id=2, title="Song (Karaoke Version)", artist="A", listeners=500),
        cand(dz_id=3, artist="Ghost", listeners=10, fans=3, graph_sources=1, support=1),
        cand(dz_id=4, artist="Lofi Farm", title="Deep Sleep Music", listeners=900),
        cand(dz_id=5, artist="Real", title="Tune - Live", listeners=900, year=2026),
        cand(dz_id=6, artist="Real", title="Tune", listeners=900, year=2025),
        cand(dz_id=7, artist="Twin Graph", listeners=None, fans=None, graph_sources=2),
        cand(lane="lost", source="labels", dz_id=8, artist="Obscure 1974", listeners=None, fans=None),
    ]
    kept, stats = gates.apply(cands, known(artist_norms={"known band"}), ctx.cfg)
    ids = sorted(c.dz_id for c in kept)
    assert ids == [6, 7, 8]
    assert stats["known artist"] == 1 and stats["junk"] == 1 and stats["filler"] == 1
    assert stats["no real-listener evidence"] == 1 and stats["duplicates"] == 1


def test_side_projects_and_remixes(ctx):
    index = gates.variant_index({"alex g", "khruangbin", "air", "beach house"})
    assert gates.is_artist_variant("alex g online", index)
    assert gates.is_artist_variant("alexgoffline", index)
    assert gates.is_artist_variant("khruangbin and leon bridges", index)
    assert not gates.is_artist_variant("air supply", index)
    assert not gates.is_artist_variant("beachy head", index)
    cands = [
        cand(lane="lost", source="labels", dz_id=1, artist="M Wylde", title="Bring Me Down (Isaac Galvez Remix)"),
        cand(lane="lost", source="graph", dz_id=2, artist="Mediavolo", title="Mass", album="Mass Anasthesia (Remixes)"),
        cand(lane="lost", source="graph", dz_id=3, artist="Mossy Kilcher", title="Going to Blow"),
        cand(lane="fresh", source="graph", dz_id=4, artist="alex g online", title="East Coast", listeners=900),
    ]
    kept, stats = gates.apply(cands, known(artist_norms={"alex g"}), ctx.cfg)
    assert [c.dz_id for c in kept] == [3]
    assert stats["remix"] == 2 and stats["side project of a known artist"] == 1


def test_fast_release_pace_is_rejected(ctx):
    c = cand(dz_id=9, artist="Upload Farm", listeners=400, pace=60)
    kept, stats = gates.apply([c], known(), ctx.cfg)
    assert not kept and stats["filler"] == 1


def test_score_reweights_missing_features(ctx):
    taste = Taste()
    a = cand(dz_id=1, artist="A", graph=0.01, graph_sources=2, support=4)
    b = cand(dz_id=2, artist="B", graph=0.001, graph_sources=1, support=1)
    compute([a, b], taste, {}, ctx.cfg)
    assert "audio" not in a.feats and "tag" not in a.feats
    assert a.score > b.score
    assert abs(a.score - 1.0) < 1e-9


def test_score_uses_audio_and_penalizes_popularity(ctx):
    taste = Taste()
    v1 = np.array([1, 0] + [0] * 510, dtype=np.float32)
    v2 = np.array([0, 1] + [0] * 510, dtype=np.float32)
    taste.seed_ids = [100]
    taste.seed_vecs = v1[None, :]
    taste.seed_weights = np.array([1.0])
    taste.seed_labels = ["Seed - Song"]
    taste.modes = v1[None, :]
    near = cand(dz_id=1, artist="Near", listeners=1000)
    far = cand(dz_id=2, artist="Far", listeners=1000)
    big = cand(dz_id=3, artist="Big", listeners=49000)
    compute([near, far, big], taste, {1: v1, 2: v2, 3: v1}, ctx.cfg)
    assert near.score > far.score
    assert near.score > big.score
    assert near.nearest == "Seed - Song"


def test_select_caps_and_decades(ctx):
    cfg = ctx.cfg
    pool = []
    for i in range(10):
        pool.append(cand(lane="lost", source="labels", dz_id=i, artist=f"A{i % 3}", year=1975, label="Numero Group"))
        pool[-1].score = 1.0 - i * 0.01
    for i in range(10, 20):
        pool.append(cand(lane="lost", source="discogs", dz_id=i, artist=f"B{i}", year=1960 + (i % 4) * 10))
        pool[-1].score = 0.9 - i * 0.01
    chosen = select(pool, 10, cfg, "lost")
    artists = [c.artist_key for c in chosen]
    assert len(artists) == len(set(artists))
    assert sum(1 for c in chosen if c.label == "Numero Group") <= cfg["selection"]["per_label"]
    decades = {}
    for c in chosen:
        decades[c.year // 10] = decades.get(c.year // 10, 0) + 1
    assert max(decades.values()) <= 4


def test_label_and_discogs_helpers():
    assert label_matches("The Numero Group", "Numero Group")
    assert label_matches("Light In The Attic Records", "Light in the Attic")
    assert not label_matches("Sony Music", "Numero Group")
    assert not label_matches("Mississippi Rain Records", "Mississippi Records")
    assert label_matches("HABIBI Funk Records", "Habibi Funk")
    assert _discogs_title("Ida (2) - Will You Find Me") == ("Ida", "Will You Find Me")
    assert _discogs_title("Lewis* - L'Amour") == ("Lewis", "L'Amour")
    picked = map_styles({"shoegaze": 0.9, "dream pop": 0.5, "jazz": 0.3, "seen live": 0.2}, 5)
    values = [v for (_, v), _ in picked]
    assert "Shoegaze" in values and "Dream Pop" in values
