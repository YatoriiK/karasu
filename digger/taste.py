import json
import math
from collections import defaultdict

import numpy as np

from .audio import embed_tracks, model_name
from .net import NetError
from .resolve import deezer_artist, seed_to_deezer, store_dz_track
from .util import norm_artist

DIM = 512


class Taste:
    def __init__(self):
        self.seed_ids = []
        self.seed_vecs = np.zeros((0, DIM), dtype=np.float32)
        self.seed_weights = np.zeros(0)
        self.seed_labels = []
        self.modes = np.zeros((0, DIM), dtype=np.float32)
        self.mode_weights = np.zeros(0)
        self.mode_labels = []
        self.artists = {}
        self.tags = {}
        self.mb_tags = {}
        self.neg = None

    @property
    def has_audio(self):
        return len(self.seed_ids) > 0

    def audio_sims(self, matrix):
        if not self.has_audio or len(matrix) == 0:
            return None, None, None
        seed_cos = matrix @ self.seed_vecs.T
        k = min(5, seed_cos.shape[1])
        top = np.sort(seed_cos, axis=1)[:, -k:]
        knn = top.mean(axis=1)
        mode_cos = matrix @ self.modes.T
        mode_best = mode_cos.max(axis=1)
        nearest = seed_cos.argmax(axis=1)
        return 0.5 * mode_best + 0.5 * knn, mode_cos.argmax(axis=1), nearest

    def dislike_sims(self, matrix):
        if self.neg is None or len(self.neg) == 0 or len(matrix) == 0:
            return None
        return (matrix @ self.neg.T).max(axis=1)


def _seed_rows(db, limit):
    return db.q(
        "select t.*, s.w from (select ref, sum(weight) w from seeds where kind like 'track:%' group by ref) s "
        "join sp_tracks t on t.id = s.ref order by s.w desc limit ?",
        (limit,),
    )


def _kmeans(vectors, weights, lo, hi):
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    n = len(vectors)
    if n < 8:
        return vectors.mean(axis=0, keepdims=True), np.zeros(n, dtype=int)
    hi = max(1, min(hi, n // 6))
    lo = max(1, min(lo, hi))
    best = None
    for k in range(lo, hi + 1):
        km = KMeans(n_clusters=k, n_init=8, random_state=0).fit(vectors, sample_weight=weights)
        if k == 1:
            score = 0.0
        else:
            score = silhouette_score(vectors, km.labels_, metric="cosine")
        if best is None or score > best[0] + 0.005:
            best = (score, km)
    km = best[1]
    centers = km.cluster_centers_ / np.maximum(np.linalg.norm(km.cluster_centers_, axis=1, keepdims=True), 1e-9)
    return centers.astype(np.float32), km.labels_


def _mb_tags(ctx, artists):
    tags = defaultdict(float)
    for artist in artists:
        try:
            found = ctx.mb.search_artist(artist["name"], limit=3)
        except NetError:
            continue
        target = norm_artist(artist["name"])
        match = next((a for a in found
                      if norm_artist(a.get("name")) == target and int(a.get("score") or 0) >= 90), None)
        if not match:
            continue
        items = [t for t in match.get("tags") or [] if t.get("name") and (t.get("count") or 0) > 0]
        total = sum(t["count"] for t in items) or 1
        for t in items:
            tags[t["name"].strip().lower()] += artist["weight"] * t["count"] / total
    norm = math.sqrt(sum(v * v for v in tags.values())) or 1.0
    return {t: v / norm for t, v in tags.items()}


def build(ctx, seed_artist_names=None, progress=None, exclude_artists=()):
    exclude_artists = set(exclude_artists)
    taste = Taste()
    db, cfg = ctx.db, ctx.cfg
    weights = {}
    previews = {}
    labels = {}
    artist_weight = defaultdict(float)
    artist_names = {}
    artist_dz = {}
    if seed_artist_names:
        for name in seed_artist_names:
            artist = deezer_artist(ctx, name)
            if not artist:
                ctx.log(f"  seed artist not found on Deezer: {name}")
                continue
            key = norm_artist(artist["name"])
            artist_weight[key] += 3.0
            artist_names[key] = artist["name"]
            artist_dz[key] = artist["id"]
            for rank, t in enumerate(ctx.dz.artist_top(artist["id"], limit=8)):
                store_dz_track(db, t)
                weights[t["id"]] = weights.get(t["id"], 0) + 1.0 - rank * 0.05
                previews[t["id"]] = t.get("preview")
                labels[t["id"]] = f"{artist['name']} - {t.get('title')}"
    else:
        rows = _seed_rows(db, int(cfg["taste"]["max_seed_tracks"]))
        ctx.log(f"  mapping {len(rows)} seed tracks to Deezer")
        for i, row in enumerate(rows, 1):
            names = json.loads(row["artists"] or "[]")
            if exclude_artists and any(norm_artist(n) in exclude_artists for n in names):
                continue
            dz_id = seed_to_deezer(ctx, row)
            if names:
                key = norm_artist(names[0])
                artist_weight[key] += row["w"]
                artist_names.setdefault(key, names[0])
            if dz_id:
                weights[dz_id] = weights.get(dz_id, 0) + row["w"]
                labels[dz_id] = f"{names[0] if names else '?'} - {row['name']}"
                drow = db.one("select artist_id, artist from dz_tracks where id=?", (dz_id,))
                if drow and names:
                    artist_dz.setdefault(norm_artist(names[0]), drow["artist_id"])
            if progress and i % 100 == 0:
                progress(i, len(rows))
        for row in db.q(
            "select a.name, a.norm, sum(s.weight) w from seeds s join sp_artists a on a.id = s.ref "
            "where s.kind like 'artist:%' group by a.id"
        ):
            if row["norm"] in exclude_artists:
                continue
            artist_weight[row["norm"]] += row["w"]
            artist_names.setdefault(row["norm"], row["name"])
    for key, weight in artist_weight.items():
        taste.artists[key] = {"name": artist_names.get(key, key), "weight": weight, "dz_id": artist_dz.get(key)}
    missing = sorted((k for k, a in taste.artists.items() if not a["dz_id"]),
                     key=lambda k: -taste.artists[k]["weight"])[:150]
    for key in missing:
        try:
            found = deezer_artist(ctx, taste.artists[key]["name"])
        except NetError:
            found = None
        if found:
            taste.artists[key]["dz_id"] = found["id"]
    if weights:
        embed_tracks(ctx, [(i, previews.get(i)) for i in weights], progress=progress)
        vecs = db.vecs(weights.keys(), model=model_name(cfg))
        ids = [i for i in weights if i in vecs]
        if ids:
            taste.seed_ids = ids
            taste.seed_vecs = np.stack([vecs[i] for i in ids]).astype(np.float32)
            taste.seed_weights = np.array([weights[i] for i in ids])
            taste.seed_labels = [labels.get(i, str(i)) for i in ids]
            centers, assign = _kmeans(taste.seed_vecs, taste.seed_weights,
                                      int(cfg["taste"]["min_modes"]), int(cfg["taste"]["max_modes"]))
            taste.modes = centers
            taste.mode_weights = np.array([taste.seed_weights[assign == m].sum() for m in range(len(centers))])
            for m in range(len(centers)):
                members = np.where(assign == m)[0]
                if len(members) == 0:
                    taste.mode_labels.append("")
                    continue
                fit = taste.seed_vecs[members] @ centers[m]
                best = members[int(np.argmax(fit + 0.02 * np.log1p(taste.seed_weights[members])))]
                taste.mode_labels.append(taste.seed_labels[best])
    if ctx.lfm.enabled:
        top_artists = sorted(taste.artists.values(), key=lambda a: -a["weight"])[:120]
        tags = defaultdict(float)
        for artist in top_artists:
            try:
                for tag, count in ctx.lfm.top_tags(artist["name"], limit=15):
                    tags[tag] += artist["weight"] * count / 100.0
            except NetError:
                continue
        total = math.sqrt(sum(v * v for v in tags.values())) or 1.0
        taste.tags = {t: v / total for t, v in tags.items()}
    taste.mb_tags = _mb_tags(ctx, sorted(taste.artists.values(), key=lambda a: -a["weight"])[:40])
    neg_ids = [r[0] for r in db.q("select dz_id from feedback where kind in ('down', 'never_artist') and dz_id is not null")]
    neg_ids += [r[0] for r in db.q("select dz_id from recs where outcome='played_not_saved'")]
    if neg_ids:
        nv = db.vecs(neg_ids, model=model_name(cfg))
        if nv:
            taste.neg = np.stack(list(nv.values())).astype(np.float32)
    up_ids = [r[0] for r in db.q("select dz_id from feedback where kind='up' and dz_id is not null")]
    up_ids += [r[0] for r in db.q("select dz_id from recs where outcome='saved'")]
    if up_ids and taste.has_audio:
        uv = db.vecs(up_ids, model=model_name(cfg))
        extra = [i for i in uv if i not in set(taste.seed_ids)]
        if extra:
            taste.seed_ids += extra
            taste.seed_vecs = np.vstack([taste.seed_vecs, np.stack([uv[i] for i in extra])]).astype(np.float32)
            taste.seed_weights = np.concatenate([taste.seed_weights, np.full(len(extra), 2.0)])
            for i in extra:
                row = db.one("select artist, title from dz_tracks where id=?", (i,))
                taste.seed_labels.append(f"{row['artist']} - {row['title']}" if row else str(i))
    return taste
