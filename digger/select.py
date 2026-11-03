import math
from collections import Counter

from .lanes import _label_norm


def _slots(shares, n):
    total = sum(shares.values())
    if total <= 0:
        return {}
    raw = {k: n * v / total for k, v in shares.items()}
    slots = {k: int(math.floor(v)) for k, v in raw.items()}
    left = n - sum(slots.values())
    for k in sorted(raw, key=lambda k: -(raw[k] - slots[k]))[:left]:
        slots[k] += 1
    return slots


def select(cands, n, cfg, lane, n_modes=0):
    scfg = cfg["selection"]
    lam = float(scfg["mmr_lambda"])
    per_artist = int(scfg["per_artist"])
    per_label = int(scfg["per_label"])
    decade_cap = math.ceil(n * float(cfg["lost"]["decade_share_cap"])) if lane == "lost" else None
    quotas = dict(cfg["quotas"].get(lane, {}))
    present = {c.source for c in cands}
    shares = {s: q for s, q in quotas.items() if s in present or s == "wildcard"}
    slots = _slots(shares, n)
    floor = float(scfg.get("min_score", 0.0))
    pool = sorted((c for c in cands if c.score >= floor), key=lambda c: -c.score)
    chosen = []
    artists, labels, decades, used = Counter(), Counter(), Counter(), Counter()

    def allowed(c):
        if artists[c.artist_key] >= per_artist:
            return False
        label = _label_norm(c.label) if c.label else None
        if label and labels[label] >= per_label:
            return False
        if decade_cap and c.year and decades[c.year // 10] >= decade_cap:
            return False
        return True

    def mmr(c, relevance):
        sim = 0.0
        if c.vec is not None:
            for s in chosen:
                if s.vec is not None:
                    sim = max(sim, float(c.vec @ s.vec))
        return lam * relevance - (1 - lam) * sim

    def take(c, slot):
        chosen.append(c)
        pool.remove(c)
        artists[c.artist_key] += 1
        if c.label:
            labels[_label_norm(c.label)] += 1
        if c.year:
            decades[c.year // 10] += 1
        used[slot] += 1

    def best(candidates, relevance=lambda c: c.score):
        options = [c for c in candidates if allowed(c)]
        if not options:
            return None
        return max(options, key=lambda c: mmr(c, relevance(c)))

    for mode in range(n_modes):
        if len(chosen) >= n:
            break
        group = [c for c in pool if c.mode == mode and slots.get(c.source, 0) > used[c.source]]
        pick = best(group)
        if pick and pick.score > 0:
            take(pick, pick.source)
    progress = True
    while len(chosen) < n and progress:
        progress = False
        for source in sorted(slots, key=lambda s: used[s] / max(1, slots[s])):
            if source == "wildcard" or used[source] >= slots[source] or len(chosen) >= n:
                continue
            pick = best([c for c in pool if c.source == source])
            if pick:
                take(pick, source)
                progress = True
    while len(chosen) < n:
        pick = best(pool, relevance=lambda c: c.feats.get("audio", c.score))
        if not pick:
            break
        take(pick, "wildcard")
    return chosen
