import json

import numpy as np

from karasu import learn
from karasu.resolve import deezer_artist


class LFMOff:
    enabled = False

    def top_tracks(self, name, limit=30):
        return []


class LFMOn(LFMOff):
    enabled = True

    def __init__(self, titles):
        self.titles = titles

    def top_tracks(self, name, limit=30):
        return self.titles


class DZ:
    def __init__(self, artists, tops=None):
        self.artists = artists
        self.tops = tops or {}

    def search_artist(self, name, limit=10):
        return self.artists

    def artist_top(self, artist_id, limit=25):
        return [{"title": t} for t in self.tops.get(artist_id, [])]


def test_deezer_artist_prefers_dominant_page(ctx):
    ctx.lfm = LFMOff()
    ctx.dz = DZ([{"id": 1, "name": "Slayer", "nb_fan": 15}, {"id": 3048, "name": "Slayer", "nb_fan": 937650},
                 {"id": 9, "name": "$LAYER", "nb_fan": 6}])
    assert deezer_artist(ctx, "Slayer")["id"] == 3048


def test_deezer_artist_ambiguous_without_titles(ctx):
    ctx.lfm = LFMOff()
    ctx.dz = DZ([{"id": 1, "name": "Ida", "nb_fan": 900}, {"id": 2, "name": "IDA", "nb_fan": 600}])
    assert deezer_artist(ctx, "Ida") is None


def test_deezer_artist_uses_title_overlap(ctx):
    ctx.lfm = LFMOn(["Shrug", "Late Blues", "Maybe"])
    ctx.dz = DZ([{"id": 1, "name": "Ida", "nb_fan": 900}, {"id": 2, "name": "IDA", "nb_fan": 600}],
                tops={1: ["Pop Song", "Other"], 2: ["Shrug", "Maybe (Remastered)", "X"]})
    assert deezer_artist(ctx, "Ida")["id"] == 2


def _add_recs(ctx, n, source, saved_ratio, feats):
    for i in range(n):
        outcome = "saved" if i < n * saved_ratio else "played_not_saved"
        ctx.db.x("insert into recs(lane, source, dz_id, sp_id, artist_key, title, features, outcome, added_at) "
                 "values('fresh', ?, ?, ?, ?, 't', ?, ?, '2026-10-01T00:00:00Z')",
                 (source, hash((source, i)) % 10_000_000, f"{source}{i}", f"{source}{i}", json.dumps(feats(i, outcome)),
                  outcome))


def test_learn_waits_then_learns(ctx):
    logs = []
    assert learn.run(ctx, log=logs.append) is False
    rng = np.random.default_rng(1)

    def feats(i, outcome):
        good = outcome == "saved"
        return {"audio": float(np.clip(rng.normal(0.75 if good else 0.35, 0.1), 0, 1)),
                "graph": float(rng.uniform()), "tag": float(rng.uniform())}

    _add_recs(ctx, 150, "graph", 0.6, feats)
    _add_recs(ctx, 100, "deep_tags", 0.1, feats)
    assert learn.run(ctx, log=logs.append) is True
    settings = ctx.db.settings()
    assert float(settings["weights.audio"]) > float(settings["weights.graph"])
    assert float(settings["quotas.fresh.graph"]) > 0.1
