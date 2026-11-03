import threading
import time

import numpy as np

FOLDS = 5
C = 1.0
MIN_POSITIVE = 30
MIN_NEGATIVE = 100
EVERY = 600
GROWTH = 0.1


def snapshot(corpus):
    with corpus.lock:
        return corpus.stamp, corpus.ids, corpus.matrix, corpus.index, corpus.artist_keys


def labels(corpus, ids, index, keys):
    db = corpus.ctx.db
    positive = {i: float(w) for i, w in corpus.library().items() if i in index}
    for r in db.q("select dz_id from feedback where kind='up' and dz_id is not null"):
        if r[0] in index:
            positive[r[0]] = max(positive.get(r[0], 0.0), 2.0)
    for r in db.q("select dz_id from recs where outcome in ('saved', 'replayed') and dz_id is not null"):
        if r[0] in index:
            positive[r[0]] = max(positive.get(r[0], 0.0), 1.5)
    hard = {}
    for r in db.q("select dz_id from recs where outcome='played_not_saved' and dz_id is not null"):
        hard[r[0]] = 1.5
    hidden = {r[0] for r in db.q("select value from exclusions where kind='artist'")}
    hidden |= {r[0] for r in db.q("select artist_key from feedback where kind='never_artist' and artist_key is not null")}
    for n, key in enumerate(keys):
        if key in hidden:
            hard[int(ids[n])] = 2.0
    for r in db.q("select dz_id from feedback where kind in ('down', 'never_artist') and dz_id is not null"):
        hard[r[0]] = 3.0
    return positive, {i: w for i, w in hard.items() if i in index and i not in positive}


def train(corpus):
    from sklearn.linear_model import LogisticRegression

    stamp, ids, matrix, index, keys = snapshot(corpus)
    positive, hard = labels(corpus, ids, index, keys)
    pos_rows = np.array([index[i] for i in positive], dtype=np.int64)
    hard_rows = np.array([index[i] for i in hard], dtype=np.int64)
    taken = np.zeros(len(ids), dtype=bool)
    taken[pos_rows] = True
    taken[hard_rows] = True
    open_rows = np.flatnonzero(~taken)
    if len(pos_rows) < MIN_POSITIVE or len(open_rows) < MIN_NEGATIVE:
        return None
    pos_w = np.clip(np.array([positive[int(ids[r])] for r in pos_rows], dtype=np.float64), 0.5, 4.0)
    hard_w = np.array([hard[int(ids[r])] for r in hard_rows], dtype=np.float64)
    fold = np.random.default_rng(len(open_rows)).integers(0, FOLDS, len(open_rows))

    def model(neg_rows):
        X = np.vstack([matrix[pos_rows], matrix[hard_rows], matrix[neg_rows]])
        y = np.concatenate([np.ones(len(pos_rows)), np.zeros(len(hard_rows) + len(neg_rows))])
        neg_total = len(neg_rows) + hard_w.sum()
        w = np.concatenate([pos_w * (neg_total / pos_w.sum()), hard_w, np.ones(len(neg_rows))])
        return LogisticRegression(C=C, max_iter=3000).fit(X, y, sample_weight=w)

    full = model(open_rows)
    logits = matrix @ full.coef_[0] + full.intercept_[0]
    for k in range(FOLDS):
        held = open_rows[fold == k]
        part = model(open_rows[fold != k])
        logits[held] = matrix[held] @ part.coef_[0] + part.intercept_[0]
    scores = 1.0 / (1.0 + np.exp(-logits))
    return {
        "stamp": stamp,
        "scores": dict(zip(ids.tolist(), scores.tolist())),
        "coef": full.coef_[0].astype(np.float32),
        "intercept": float(full.intercept_[0]),
        "size": len(ids),
        "positives": len(pos_rows),
        "negatives": len(hard_rows) + len(open_rows),
    }


class Fit:
    def __init__(self, corpus):
        self.corpus = corpus
        self.state = None
        self.key = None
        self.trained_at = 0.0
        self.running = False
        self.lock = threading.Lock()
        self.aligned = (None, None, None)

    def _key(self):
        db = self.corpus.ctx.db
        feedback = db.one("select count(*), coalesce(max(id), 0) from feedback")
        hidden = db.one("select count(*) from exclusions where kind='artist'")[0]
        outcomes = db.one("select count(*) from recs where outcome is not null")[0]
        return (self.corpus.stamp, tuple(feedback), hidden, outcomes)

    def _stale(self, key):
        if self.state is None:
            return True
        if key == self.key:
            return False
        if key[1:] != self.key[1:]:
            return True
        grown = (len(self.corpus.ids) - self.state["size"]) / max(self.state["size"], 1)
        return grown > GROWTH or time.monotonic() - self.trained_at > EVERY

    def _run(self, key):
        try:
            state = train(self.corpus)
            if state is not None:
                self.corpus.ctx.db.set_meta("fit_model", {"coef": state["coef"].round(6).tolist(),
                                                          "intercept": state["intercept"],
                                                          "positives": state["positives"],
                                                          "negatives": state["negatives"]})
            with self.lock:
                self.state, self.key, self.trained_at = state, key, time.monotonic()
        except Exception as exc:
            self.corpus.ctx.log(f"taste model failed: {exc!r}")
        finally:
            self.running = False

    def ensure(self, wait=False):
        key = self._key()
        with self.lock:
            start = self._stale(key) and not self.running
            if start:
                self.running = True
        if start:
            if wait:
                self._run(key)
            else:
                threading.Thread(target=self._run, args=(key,), daemon=True, name="taste-model").start()
        return self.state

    def scores(self, wait=False):
        state = self.ensure(wait)
        if state is None:
            return None
        stamp, ids, matrix, _, _ = snapshot(self.corpus)
        cached_state, cached_stamp, cached = self.aligned
        if cached_state is state and cached_stamp == stamp:
            return cached
        out = 1.0 / (1.0 + np.exp(-(matrix @ state["coef"] + state["intercept"])))
        known = state["scores"]
        for n, dz_id in enumerate(ids.tolist()):
            value = known.get(dz_id)
            if value is not None:
                out[n] = value
        out = out.astype(np.float32)
        self.aligned = (state, stamp, out)
        return out

    def vector(self, vec):
        state = self.state
        if state is None or vec is None:
            return None
        return float(1.0 / (1.0 + np.exp(-(np.asarray(vec, dtype=np.float32) @ state["coef"] + state["intercept"]))))
