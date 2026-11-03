import threading
import time

import numpy as np

from ..audio import model_name
from ..util import norm_artist
from .fit import Fit


class Corpus:
    def __init__(self, ctx):
        self.ctx = ctx
        self.lock = threading.Lock()
        self.stamp = None
        self.ids = np.zeros(0, dtype=np.int64)
        self.matrix = np.zeros((0, 512), dtype=np.float32)
        self.artist_ids = np.zeros(0, dtype=np.int64)
        self.artist_keys = []
        self.index = {}
        self._taste = None
        self._checked = 0.0
        self.fitter = Fit(self)

    def _current_stamp(self):
        row = self.ctx.db.one("select coalesce(max(rowid), 0) from embeddings")
        lib = self.ctx.db.one("select coalesce(max(rowid), 0) from sp_dz")
        return (row[0], lib[0])

    def refresh(self, force=False):
        now = time.monotonic()
        if not force and self.stamp is not None and now - self._checked < 5:
            return False
        self._checked = now
        stamp = self._current_stamp()
        if not force and stamp == self.stamp:
            return False
        with self.lock:
            rows = self.ctx.db.q(
                "select e.dz_id, e.vec, t.artist_id, t.artist from embeddings e left join dz_tracks t on t.id = e.dz_id "
                "where e.model=?", (model_name(self.ctx.cfg),))
            self.ids = np.array([r["dz_id"] for r in rows], dtype=np.int64)
            self.matrix = (np.stack([np.frombuffer(r["vec"], dtype=np.float32) for r in rows])
                           if rows else np.zeros((0, 512), dtype=np.float32))
            self.artist_ids = np.array([r["artist_id"] or 0 for r in rows], dtype=np.int64)
            self.artist_keys = [norm_artist(r["artist"]) for r in rows]
            self.index = {int(i): n for n, i in enumerate(self.ids)}
            self.stamp = stamp
            self._taste = None
        return True

    def vec(self, dz_id):
        n = self.index.get(int(dz_id))
        return None if n is None else self.matrix[n]

    def mask(self, exclude_ids=(), exclude_artist_ids=(), exclude_artist_keys=()):
        keep = np.ones(len(self.ids), dtype=bool)
        if exclude_ids:
            keep &= ~np.isin(self.ids, np.fromiter((int(i) for i in exclude_ids), dtype=np.int64))
        if exclude_artist_ids:
            keep &= ~np.isin(self.artist_ids, np.fromiter((int(i) for i in exclude_artist_ids), dtype=np.int64))
        if exclude_artist_keys:
            keys = set(exclude_artist_keys)
            keep &= np.array([k not in keys for k in self.artist_keys], dtype=bool)
        return keep

    def similar(self, query, k=50, keep=None):
        self.refresh()
        if len(self.ids) == 0:
            return []
        query = np.asarray(query, dtype=np.float32)
        if query.ndim == 1:
            sims = self.matrix @ query
        else:
            sims = (self.matrix @ query.T).max(axis=1)
        if keep is not None:
            sims = np.where(keep, sims, -np.inf)
        k = min(k, int(np.isfinite(sims).sum()))
        if k <= 0:
            return []
        top = np.argpartition(-sims, k - 1)[:k]
        top = top[np.argsort(-sims[top])]
        return [(int(self.ids[i]), float(sims[i])) for i in top]

    def library(self):
        rows = self.ctx.db.q(
            "select dz_id, sum(w) w from ("
            "select s.dz_id, x.weight w from sp_dz s join "
            "(select ref, weight from seeds where kind like 'track:%' "
            " union all select track_id, 0.8 from saved) x on x.ref = s.sp_id where s.dz_id > 0 "
            "union all select cast(ref as integer), weight from seeds where kind = 'pick:track'"
            ") group by dz_id")
        return {r["dz_id"]: r["w"] for r in rows}

    def taste(self):
        self.refresh()
        if self._taste is not None:
            return self._taste
        weights = self.library()
        ids = [i for i in weights if i in self.index]
        if not ids:
            self._taste = None
            return None
        rows = np.array([self.index[i] for i in ids])
        vecs = self.matrix[rows]
        w = np.array([max(weights[i], 0.1) for i in ids], dtype=np.float32)
        centroid = (vecs * w[:, None]).sum(axis=0)
        centroid /= max(np.linalg.norm(centroid), 1e-9)
        modes, assign = _modes(vecs, w)
        self._taste = {"ids": ids, "vecs": vecs, "weights": w, "centroid": centroid, "modes": modes,
                       "assign": assign}
        return self._taste

    def fit(self, wait=False):
        self.refresh()
        return self.fitter.scores(wait)

    def fit_vec(self, vec):
        return self.fitter.vector(vec)

    def known_ids(self):
        return {r[0] for r in self.ctx.db.q(
            "select dz_id from sp_dz where dz_id > 0 "
            "union select cast(ref as integer) from seeds where kind = 'pick:track'")}

    def known_artist_ids(self):
        return {r[0] for r in self.ctx.db.q(
            "select distinct t.artist_id from dz_tracks t join sp_dz s on s.dz_id = t.id where t.artist_id is not null "
            "union select cast(ref as integer) from seeds where kind = 'pick:artist'")}


def _modes(vecs, weights, lo=4, hi=10):
    from sklearn.cluster import KMeans

    n = len(vecs)
    if n < 12:
        c = vecs.mean(axis=0, keepdims=True)
        return c / np.linalg.norm(c, axis=1, keepdims=True), np.zeros(n, dtype=int)
    k = max(lo, min(hi, n // 60 + lo))
    km = KMeans(n_clusters=k, n_init=4, random_state=0).fit(vecs, sample_weight=weights)
    centers = km.cluster_centers_ / np.maximum(np.linalg.norm(km.cluster_centers_, axis=1, keepdims=True), 1e-9)
    return centers.astype(np.float32), km.labels_
