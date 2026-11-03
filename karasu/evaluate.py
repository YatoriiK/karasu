import json
import random
import statistics
from datetime import timedelta

import numpy as np

from .audio import model_name
from .graph import crawl
from .taste import build
from .util import norm_artist, now


def run(ctx, holdout=0.2, days=120):
    db = ctx.db
    since = (now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    recent = db.q(
        "select t.artists from saved s join sp_tracks t on t.id = s.track_id where s.added_at >= ?", (since,))
    artists = sorted({norm_artist(json.loads(r[0] or "[]")[0]) for r in recent if json.loads(r[0] or "[]")})
    if len(artists) < 10:
        print(f"Only {len(artists)} artists saved in the last {days} days; need at least 10 for an offline check.")
    else:
        rng = random.Random(0)
        held = set(rng.sample(artists, max(3, int(len(artists) * holdout))))
        print(f"Holding out {len(held)} of {len(artists)} recently saved artists")
        taste = build(ctx, exclude_artists=held)
        g = crawl(ctx, taste, log=lambda m: None)
        ranked = [k for k in sorted(g.names, key=lambda k: -g.rank.get(k, 0)) if k not in g.seeds]
        position = {k: i for i, k in enumerate(ranked)}
        hits = sorted(position[k] for k in held if k in position)
        for cut in (50, 200, 1000):
            print(f"  recall@{cut}: {sum(1 for h in hits if h < cut) / len(held):.0%}")
        print(f"  found in graph at all: {len(hits)}/{len(held)}"
              + (f", median rank {int(statistics.median(hits))}" if hits else ""))
        print("  (sanity check only: it rewards finding artists you already like, which favors popular ones)")
    recs = db.q("select r.*, l.listeners from recs r left join lfm_artists l on l.norm = r.artist_key "
                "where r.added_at >= ?", ((now() - timedelta(days=28)).strftime("%Y-%m-%dT%H:%M:%SZ"),))
    if recs:
        listeners = [r["listeners"] for r in recs if r["listeners"] is not None]
        years = [r["year"] for r in recs if r["year"]]
        vecs = db.vecs([r["dz_id"] for r in recs], model=model_name(ctx.cfg))
        print(f"Last 4 weeks of picks: {len(recs)}")
        if listeners:
            print(f"  median Last.fm listeners: {int(statistics.median(listeners))}")
        if years:
            decades = {}
            for y in years:
                decades[f"{y // 10 * 10}s"] = decades.get(f"{y // 10 * 10}s", 0) + 1
            print("  decades: " + ", ".join(f"{k} {v}" for k, v in sorted(decades.items())))
        if len(vecs) > 2:
            m = np.stack(list(vecs.values()))
            sims = m @ m.T
            n = len(m)
            print(f"  diversity (1 - mean pairwise similarity): {1 - (sims.sum() - n) / (n * n - n):.2f}")
