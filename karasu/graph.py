import math
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy import sparse

from .net import NetError
from .util import norm_artist


class Graph:
    def __init__(self):
        self.names = {}
        self.dz = {}
        self.fans = {}
        self.edges = defaultdict(dict)
        self.sources = defaultdict(set)
        self.support = defaultdict(set)
        self.parent = {}
        self.expanded = set()
        self.seeds = {}
        self.rank = {}

    def add(self, name, dz_id=None, fans=None):
        key = norm_artist(name)
        if not key:
            return None
        self.names.setdefault(key, name)
        if dz_id:
            self.dz.setdefault(key, dz_id)
        if fans is not None:
            self.fans[key] = fans
        return key

    def link(self, src, dst, weight, source):
        if not dst or src == dst:
            return
        self.edges[src][dst] = max(self.edges[src].get(dst, 0.0), weight)
        self.sources[dst].add(source)
        self.support[dst].add(src)
        best = self.parent.get(dst)
        if best is None or weight > best[1]:
            self.parent[dst] = (src, weight)

    def via(self, key):
        hops = []
        seen = {key}
        cur = key
        for _ in range(3):
            step = self.parent.get(cur)
            if not step or step[0] in seen:
                break
            cur = step[0]
            seen.add(cur)
            hops.append(self.names.get(cur, cur))
            if cur in self.seeds:
                break
        return hops


def _neighbors(ctx, name, dz_id, gcfg):
    similar, related = [], []
    if ctx.lfm.enabled:
        try:
            similar = ctx.lfm.similar(name, limit=int(gcfg["lastfm_limit"]))
        except NetError:
            similar = []
    if dz_id:
        try:
            related = ctx.dz.artist_related(dz_id, limit=int(gcfg["deezer_limit"]))
        except NetError:
            related = []
    return similar, related


def _apply(g, key, similar, related):
    for item in similar:
        g.link(key, g.add(item["name"]), max(0.05, float(item["match"])), "lastfm")
    count = len(related)
    for i, artist in enumerate(related):
        dst = g.add(artist.get("name"), artist.get("id"), artist.get("nb_fan"))
        g.link(key, dst, 1.0 - 0.8 * i / max(1, count), "deezer")
    g.expanded.add(key)


def _expand_all(ctx, g, keys, gcfg, threads=6):
    jobs = [(k, g.names[k], g.dz.get(k)) for k in keys if k not in g.expanded]
    with ThreadPoolExecutor(max_workers=threads) as pool:
        results = pool.map(lambda job: (job[0], _neighbors(ctx, job[1], job[2], gcfg)), jobs)
        for key, (similar, related) in results:
            _apply(g, key, similar, related)


def _damping(g, key, strength):
    fans = g.fans.get(key)
    if fans is None:
        return None
    return (1.0 + math.log10(1.0 + fans / 500.0)) ** -strength


def pagerank(g, restart=0.15, strength=0.6, iterations=40):
    keys = list(g.names)
    if not keys:
        return {}
    idx = {k: i for i, k in enumerate(keys)}
    damp = [_damping(g, k, strength) for k in keys]
    known = [d for d in damp if d is not None]
    neutral = float(np.median(known)) if known else 1.0
    damp = np.array([d if d is not None else neutral for d in damp])
    rows, cols, vals = [], [], []
    for src, outs in g.edges.items():
        if not outs:
            continue
        dsts = list(outs)
        ws = np.array([outs[d] * damp[idx[d]] for d in dsts])
        total = ws.sum()
        if total <= 0:
            continue
        for dst, w in zip(dsts, ws):
            rows.append(idx[dst])
            cols.append(idx[src])
            vals.append(w / total)
    n = len(keys)
    matrix = sparse.csr_matrix((vals, (rows, cols)), shape=(n, n))
    start = np.zeros(n)
    for key, weight in g.seeds.items():
        if key in idx:
            start[idx[key]] += weight
    if start.sum() <= 0:
        return {k: 0.0 for k in keys}
    start /= start.sum()
    r = start.copy()
    for _ in range(iterations):
        r = restart * start + (1 - restart) * (matrix @ r)
        r /= max(r.sum(), 1e-12)
    return {k: float(r[i]) for i, k in enumerate(keys)}


def crawl(ctx, taste, log=print, seed_limit=150):
    gcfg = ctx.cfg["graph"]
    g = Graph()
    top = sorted(taste.artists.values(), key=lambda a: -a["weight"])[:seed_limit]
    for artist in top:
        key = g.add(artist["name"], artist.get("dz_id"))
        if key:
            g.seeds[key] = g.seeds.get(key, 0) + artist["weight"]
    log(f"  graph: expanding {len(g.seeds)} seed artists")
    _expand_all(ctx, g, list(g.seeds), gcfg)
    rank = pagerank(g, gcfg["restart"], gcfg["pop_damping"], int(gcfg["iterations"]))
    budget = int(gcfg["expand_budget"])
    ranked = sorted((k for k in g.names if k not in g.expanded), key=lambda k: -rank.get(k, 0))
    main = ranked[:int(budget * 0.7)]
    taken = set(main)
    small = [k for k in ranked[:budget * 4]
             if k not in taken and g.fans.get(k) is not None and g.fans[k] <= int(gcfg["small_fans"])]
    frontier = main + small[:budget - len(main)]
    log(f"  graph: expanding {len(frontier)} second-hop artists")
    _expand_all(ctx, g, frontier, gcfg)
    rank = pagerank(g, gcfg["restart"], gcfg["pop_damping"], int(gcfg["iterations"]))
    deep = [k for k in sorted(g.names, key=lambda k: -rank.get(k, 0))
            if k not in g.expanded and g.fans.get(k) is not None and g.fans[k] <= int(gcfg["small_fans"])]
    deep = deep[:int(gcfg["underground_budget"])]
    if deep:
        log(f"  graph: expanding {len(deep)} underground artists")
        _expand_all(ctx, g, deep, gcfg)
    g.rank = pagerank(g, gcfg["restart"], gcfg["pop_damping"], int(gcfg["iterations"]))
    log(f"  graph: {len(g.names)} artists, {sum(len(v) for v in g.edges.values())} links")
    return g
