import re
from collections import Counter

from .util import is_filler, is_junk, is_variant, track_key

REMIX = re.compile(r"\bremix(?:es|ed)?\b|\brework\b|\bre-?edit\b|\bvip mix\b", re.I)


def variant_index(norms):
    index = {}
    for name in norms:
        if len(name) >= 5:
            index.setdefault(name.replace(" ", "")[:5], []).append(name)
    return index


def is_artist_variant(key, index):
    if not key:
        return False
    squashed = key.replace(" ", "")
    for name in index.get(squashed[:5], ()):
        if key == name:
            return True
        if key.startswith(name + " ") or key.endswith(" " + name):
            return True
        tight = name.replace(" ", "")
        if squashed.startswith(tight) and len(squashed) - len(tight) <= 8:
            return True
    return False


def real_artist(c, cfg):
    if c.lane != "fresh":
        return True
    f = cfg["fresh"]
    signals = []
    if c.listeners is not None:
        signals.append(c.listeners >= f["listeners_floor"])
    if c.fans is not None:
        signals.append(c.fans >= f["fans_floor"])
    signals.append(c.graph_sources >= 2 or c.support >= 3)
    return any(signals)


def slop(c, cfg):
    penalty = 0.0
    limit = cfg["filters"]["max_releases_6m"]
    if is_filler(c.title, c.album, c.artist):
        penalty = 1.0
    if c.pace is not None and c.pace > limit:
        penalty = max(penalty, min(1.0, 0.5 + (c.pace - limit) / (2.0 * limit)))
    if c.listeners and c.playcount is not None and c.listeners >= 50 and c.playcount / c.listeners < 1.6:
        penalty = max(penalty, 0.25)
    return penalty


def dedupe(cands):
    best = {}
    for c in cands:
        key = track_key(c.artist, c.title)
        rank = (is_variant(c.title), c.year or 9999, -(c.rank or 0))
        if key not in best or rank < best[key][0]:
            best[key] = (rank, c)
    seen = set()
    out = []
    for _, c in best.values():
        if c.dz_id in seen:
            continue
        seen.add(c.dz_id)
        out.append(c)
    return out


def apply(cands, known, cfg):
    stats = Counter()
    kept = []
    index = variant_index(known["artist_norms"] | known["blocked_artists"])
    for c in cands:
        if is_junk(c.title, c.album, c.artist):
            stats["junk"] += 1
            continue
        if c.lane == "lost" and REMIX.search(f"{c.title} {c.album or ''}"):
            stats["remix"] += 1
            continue
        if track_key(c.artist, c.title) in known["keys"]:
            stats["already heard"] += 1
            continue
        if (c.artist_key in known["artist_norms"] or c.artist_key in known["blocked_artists"]
                or c.artist_key in known.get("rec_artists", set())
                or (c.artist_dz and c.artist_dz in known.get("artist_dz", set()))):
            stats["known artist"] += 1
            continue
        if is_artist_variant(c.artist_key, index):
            stats["side project of a known artist"] += 1
            continue
        if not real_artist(c, cfg):
            stats["no real-listener evidence"] += 1
            continue
        penalty = slop(c, cfg)
        if penalty >= 1.0 or (c.pace or 0) > 3 * cfg["filters"]["max_releases_6m"]:
            stats["filler"] += 1
            continue
        c.feats["slop"] = penalty
        kept.append(c)
    before = len(kept)
    kept = dedupe(kept)
    stats["duplicates"] += before - len(kept)
    return kept, stats
