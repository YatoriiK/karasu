import math
from collections import Counter

import numpy as np

from .util import percentile_ranks

FEATURES = ("audio", "tag", "graph", "gem", "like")


def _tag_vector(tags, idf):
    vec = {t: (c / 100.0) * idf.get(t, 1.0) for t, c in (tags or {}).items()}
    norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
    return {t: v / norm for t, v in vec.items()}


def _profile_vector(profile, idf):
    vec = {t: w * idf.get(t, 1.0) for t, w in profile.items()}
    norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
    return {t: v / norm for t, v in vec.items()}


def _dot(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(t, 0.0) for t, v in a.items())


def _pop_over(c, cap):
    value = c.listeners
    if value is None:
        return 0.0
    low = 0.5 * cap
    if value <= low:
        return 0.0
    return min(1.0, math.log10(value / low) / math.log10(2.0))


def compute(cands, taste, vecs, cfg, like_fn=None):
    if not cands:
        return
    weights = cfg["weights"]
    with_vec = [c for c in cands if c.dz_id in vecs]
    if with_vec:
        matrix = np.stack([vecs[c.dz_id] for c in with_vec]).astype(np.float32)
        audio, modes, nearest = taste.audio_sims(matrix)
        dislike = taste.dislike_sims(matrix)
        like = like_fn(matrix) if like_fn else None
        for i, c in enumerate(with_vec):
            c.vec = matrix[i]
            if audio is not None:
                c.feats["audio_raw"] = float(audio[i])
                c.mode = int(modes[i])
                c.nearest = taste.seed_labels[int(nearest[i])]
            if dislike is not None:
                c.feats["dislike_raw"] = float(dislike[i])
            if like is not None:
                c.feats["like_raw"] = float(like[i])
    df = Counter()
    artists_seen = {}
    for c in cands:
        if c.tags and c.artist_key not in artists_seen:
            artists_seen[c.artist_key] = True
            df.update(c.tags.keys())
    n_docs = max(1, len(artists_seen))
    idf = {t: math.log((1 + n_docs) / (1 + d)) + 1.0 for t, d in df.items()}
    profile = _profile_vector(taste.tags, idf) if taste.tags else {}
    for c in cands:
        if profile and c.tags:
            c.feats["tag_raw"] = _dot(_tag_vector(c.tags, idf), profile)
        if c.graph:
            c.feats["graph_raw"] = math.log10(c.graph + 1e-9) + 0.15 * max(0, c.graph_sources - 1) + 0.05 * math.log1p(c.support)
        if c.have is not None:
            c.feats["gem_raw"] = (c.want or 0) / (c.have + 10.0)
    for lane in {c.lane for c in cands}:
        group = [c for c in cands if c.lane == lane]
        for feat in FEATURES + ("dislike",):
            ranks = percentile_ranks([c.feats.get(f"{feat}_raw") for c in group])
            for c, r in zip(group, ranks):
                if r is not None:
                    c.feats[feat] = r
        cap = cfg[lane]["listeners_cap"]
        for c in group:
            present = {f: c.feats[f] for f in FEATURES
                       if f in c.feats and weights.get(f, 0) > 0 and (f != "gem" or lane == "lost")}
            total_w = sum(weights[f] for f in present)
            base = sum(weights[f] * v for f, v in present.items()) / total_w if total_w else 0.0
            pop = _pop_over(c, cap)
            dislike = max(0.0, (c.feats.get("dislike", 0.0) - 0.5) * 2.0) if "dislike" in c.feats else 0.0
            c.feats["pop_over"] = pop
            c.score = (base - weights["pop_penalty"] * pop - weights["dislike_penalty"] * dislike
                       - weights["slop_penalty"] * c.feats.get("slop", 0.0))


def human(n):
    if n is None:
        return "?"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.1f}k".replace(".0k", "k")
    return str(n)


def explain(c, taste=None):
    parts = []
    if c.nearest and c.feats.get("audio", 0) >= 0.5:
        parts.append(f"sounds like {c.nearest}")
    if c.via:
        hop = c.via[0]
        if len(c.via) > 1 and c.via[-1] != hop:
            parts.append(f"similar to {hop} (via {c.via[-1]})")
        else:
            parts.append(f"similar to {hop}")
    if c.tags and taste is not None and taste.tags:
        shared = sorted((t for t in c.tags if t in taste.tags), key=lambda t: -taste.tags[t] * c.tags[t])[:3]
        if shared:
            parts.append("tags: " + ", ".join(shared))
    if c.source == "labels" and c.label:
        parts.append(f"reissued by {c.label}")
    if c.have is not None:
        parts.append(f"{c.have} Discogs owners, {c.want or 0} want it")
    if c.year:
        parts.append(str(c.year) + ("" if c.year_source in ("musicbrainz", "discogs", "title") else "?"))
    if c.listeners is not None:
        parts.append(f"{human(c.listeners)} Last.fm listeners")
    elif c.fans is not None:
        parts.append(f"{human(c.fans)} Deezer fans")
    return " · ".join(parts)
