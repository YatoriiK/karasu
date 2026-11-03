import json

import numpy as np

from .audio import model_name

MIN_OUTCOMES = 200
FEATURES = ("audio", "tag", "graph", "gem")
POSITIVE = ("saved", "replayed")
NEGATIVE = ("played_not_saved",)


def _labeled(db):
    rows = db.q("select lane, source, dz_id, features, outcome from recs where outcome is not null")
    votes = {r["dz_id"]: r["kind"] for r in db.q("select dz_id, kind from feedback order by id")}
    out = []
    for r in rows:
        vote = votes.get(r["dz_id"])
        if vote == "up" or r["outcome"] in POSITIVE:
            label = 1
        elif vote in ("down", "never_artist") or r["outcome"] in NEGATIVE:
            label = 0
        else:
            continue
        out.append((r, label))
    for dz_id, vote in votes.items():
        if dz_id and vote in ("up", "down") and not any(r["dz_id"] == dz_id for r, _ in out):
            out.append(({"lane": None, "source": "dashboard", "dz_id": dz_id, "features": "{}"}, int(vote == "up")))
    return out


def status(db):
    return len(_labeled(db))


def quotas(cfg, labeled, rng):
    result = {}
    for lane, defaults in cfg["quotas"].items():
        shares = {}
        for source, base in defaults.items():
            if source == "wildcard":
                shares[source] = base
                continue
            hits = [label for r, label in labeled if r["lane"] == lane and r["source"] == source]
            sample = rng.beta(1 + sum(hits), 1 + len(hits) - sum(hits))
            prior = rng.beta(2, 2)
            shares[source] = max(0.1, 0.5 * base + 0.5 * base * sample / max(prior, 1e-3))
        total = sum(shares.values())
        result[lane] = {s: round(v / total, 3) for s, v in shares.items()}
    return result


def weights(cfg, labeled):
    from sklearn.linear_model import LogisticRegression

    X, y = [], []
    for r, label in labeled:
        feats = json.loads(r["features"] or "{}")
        if not all(f in feats for f in ("audio", "graph")):
            continue
        X.append([feats.get(f, 0.5) for f in FEATURES])
        y.append(label)
    if len(X) < 60 or len(set(y)) < 2:
        return None
    model = LogisticRegression(C=1.0).fit(np.array(X), np.array(y))
    coef = np.clip(model.coef_[0], 0.02, None)
    learned = coef / coef.sum()
    blend = min(1.0, len(X) / 600)
    base = np.array([cfg["weights"][f] for f in FEATURES])
    base = base / base.sum()
    mixed = (1 - blend) * base + blend * learned
    return {f: round(float(v), 3) for f, v in zip(FEATURES, mixed)}


def classifier(ctx, labeled):
    from sklearn.linear_model import LogisticRegression

    vecs = ctx.db.vecs([r["dz_id"] for r, _ in labeled], model=model_name(ctx.cfg))
    pairs = [(vecs[r["dz_id"]], label) for r, label in labeled if r["dz_id"] in vecs]
    if len(pairs) < 80 or len({label for _, label in pairs}) < 2:
        return None
    X = np.stack([v for v, _ in pairs])
    y = np.array([label for _, label in pairs])
    model = LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000).fit(X, y)
    return {"coef": model.coef_[0].round(6).tolist(), "intercept": float(model.intercept_[0]), "n": len(pairs)}


def run(ctx, force=False, log=print):
    labeled = _labeled(ctx.db)
    if len(labeled) < MIN_OUTCOMES and not force:
        log(f"Learning waits for {MIN_OUTCOMES} heard picks; you have {len(labeled)}.")
        return False
    rng = np.random.default_rng()
    for lane, shares in quotas(ctx.cfg, labeled, rng).items():
        for source, share in shares.items():
            ctx.db.set_setting(f"quotas.{lane}.{source}", share)
        log(f"  {lane} quotas: {shares}")
    learned = weights(ctx.cfg, labeled)
    if learned:
        for f, v in learned.items():
            ctx.db.set_setting(f"weights.{f}", v)
        log(f"  score weights: {learned}")
    clf = classifier(ctx, labeled)
    if clf:
        ctx.db.set_meta("taste_classifier", clf)
        ctx.db.set_setting("weights.like", 0.2)
        log(f"  personal classifier trained on {clf['n']} picks")
    return True


def like_scores(db, matrix):
    clf = db.meta("taste_classifier") or db.meta("fit_model")
    if not clf or len(matrix) == 0:
        return None
    coef = np.array(clf["coef"], dtype=np.float32)
    if coef.shape[0] != matrix.shape[1]:
        return None
    return 1.0 / (1.0 + np.exp(-(matrix @ coef + clf["intercept"])))
