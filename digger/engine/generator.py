import json
import time
import uuid

import numpy as np

from ..util import norm_artist
from . import facets as F
from .catalog import Catalog, _in, parse_id
from .discover import ACTIVITIES, Context, _fans_array, _z, concept_score
from .flow import order
from .home import build_reasons

TTL = 6 * 3600


def _concept_vectors(ctx):
    from .facets import _concepts_path
    path = _concepts_path()
    if not path.exists():
        return None
    return np.load(path)


def _energy_of(dc, rows):
    matrix, present = dc.facets
    return {int(dc.corpus.ids[n]): (F.energy_value(matrix[n]) if present[n] else None) for n in rows}


def _tempo_of(db, ids):
    return {r["dz_id"]: r["tempo"] for r in _in(db, "select dz_id, tempo from dsp where dz_id in ({marks})", ids)}


def resolve_seeds(dc, seeds):
    vecs, labels, concepts = [], [], []
    dc.vec_labels = []
    energy_target, decade, history = None, None, False
    include_artists = set()
    concept_mat = _concept_vectors(dc.ctx)
    for seed in seeds or []:
        kind, value = seed.get("type"), seed.get("value")
        if kind == "track":
            k, v = parse_id(value)
            if k == "sp":
                row = dc.db.one("select dz_id from sp_dz where sp_id=? and dz_id > 0", (v,))
                v = row[0] if row else None
            vec = dc.corpus.vec(v) if v else None
            if vec is not None:
                vecs.append(vec)
                row = dc.db.one("select title, artist from dz_tracks where id=?", (v,))
                labels.append(row["title"] if row else "a song")
                dc.vec_labels.append(f"{row['artist']} – {row['title']}" if row else "your pick")
        elif kind in ("artist", "album"):
            col = "artist_id" if kind == "artist" else "album_id"
            ids = [r[0] for r in dc.db.q(f"select id from dz_tracks where {col}=?", (int(value),))]
            rows = [dc.corpus.index[i] for i in ids if i in dc.corpus.index]
            if kind == "artist":
                include_artists.add(int(value))
                row = dc.db.one("select name from dz_artists where id=?", (int(value),)) or \
                    dc.db.one("select artist as name from dz_tracks where artist_id=? limit 1", (int(value),))
                label = row["name"] if row else "an artist"
            else:
                row = dc.db.one("select album from dz_tracks where album_id=? limit 1", (int(value),))
                label = row[0] if row else "an album"
            labels.append(label)
            if rows:
                c = dc.corpus.matrix[rows].mean(axis=0)
                vecs.append(c / max(np.linalg.norm(c), 1e-9))
                dc.vec_labels.append(label)
        elif kind in ("genre", "mood", "instrument"):
            if value in F.INDEX:
                concepts.append(value)
                labels.append(F.LABELS[value])
                if concept_mat is not None:
                    vecs.append(concept_mat[F.INDEX[value]])
                    dc.vec_labels.append(f"{F.LABELS[value].lower()} feel")
        elif kind == "activity" and value in ACTIVITIES:
            a = ACTIVITIES[value]
            concepts += a["concepts"]
            energy_target = a["energy"]
            labels.append(a["label"])
        elif kind == "decade":
            decade = int(value)
            labels.append(f"{decade}s")
            era = {1960: "era_60s", 1970: "era_70s", 1980: "era_80s", 1990: "era_90s", 2000: "era_00s"}.get(decade)
            if era:
                concepts.append(era)
        elif kind == "history":
            history = True
            labels.append("your listening")
    return vecs, labels, concepts, energy_target, decade, history, include_artists


def _suggest_name(labels, params):
    if not labels:
        return "New discoveries"
    if len(labels) == 1:
        label = labels[0]
        return f"{label} mix" if params.get("seeds", [{}])[0].get("type") in ("activity", "mood", "genre") else f"Like {label}"
    return " + ".join(labels[:3])


def generate(ctx, corpus, params, nonce=None):
    dc = Context(ctx, corpus)
    rng = np.random.default_rng(nonce)
    count = int(min(max(params.get("count", 25), 5), 100))
    familiarity = float(min(max(params.get("familiarity", 0.2), 0), 1))
    discovery = float(min(max(params.get("discovery", 0.5), 0), 1))
    energy_knob = params.get("energy")
    shape = params.get("shape", "steady")
    popularity = params.get("popularity", "any")
    vecs, labels, concepts, energy_target, decade, history, include_artists = resolve_seeds(dc, params.get("seeds"))
    concepts += [c for c in params.get("moods", []) + params.get("genres", []) if c in F.INDEX]
    if energy_knob is not None:
        energy_target = float(energy_knob)
    n = len(corpus.ids)
    if n == 0:
        return {"tracks": [], "name": "Empty", "draft": None}
    if vecs:
        q = np.stack(vecs)
        sim = (corpus.matrix @ q.T).max(axis=1)
    else:
        sim = dc.taste_sims()
    score = _z(sim) * (1 - 0.45 * discovery)
    if concepts:
        c, present = concept_score(dc, concepts)
        score = score + 0.7 * np.where(present, c, 0)
    matrix, present = dc.facets
    energies = np.array([F.energy_value(matrix[i]) if present[i] else 0.5 for i in range(n)])
    if energy_target is not None:
        score = score - 2.2 * np.abs(energies - energy_target)
    fans = _fans_array(dc)
    obscurity = np.where(fans >= 0, 1 - np.clip(np.log10(fans + 10) / 5, 0, 1), 0.5)
    score = score + discovery * 0.6 * _z(obscurity) - discovery * 0.25 * _z(dc.taste_sims())
    score = score + rng.normal(scale=0.15, size=n)
    years = dc.years
    excluded = {norm_artist(a) for a in params.get("exclude_artists", [])}
    base_keep = np.array([k not in excluded for k in corpus.artist_keys], dtype=bool)
    if decade:
        base_keep &= (years >= decade) & (years < decade + 10)
    if popularity == "underground":
        base_keep &= (fans >= 0) & (fans < 1000)
    elif popularity == "niche":
        base_keep &= (fans < 0) | (fans < 10000)
    elif popularity == "known":
        base_keep &= fans >= 10000
    keep_new = dc.keep() & base_keep
    from .home import blocked_sets
    hidden, blocked, nopreview = blocked_sets(ctx.db)
    known_ids = corpus.known_ids()
    keep_known = np.array([int(i) in known_ids and int(i) not in blocked and int(i) not in nopreview
                           and k not in hidden for i, k in zip(corpus.ids, corpus.artist_keys)], dtype=bool) & base_keep
    n_known = int(round(count * familiarity))
    n_new = count - n_known

    def pick(mask, k, per_artist=1, avoid=()):
        s = np.where(mask, score, -np.inf)
        order_idx = np.argsort(-s)
        chosen, counts = [], {}
        for i in order_idx:
            if not np.isfinite(s[i]) or len(chosen) >= k:
                break
            dz_id = int(corpus.ids[i])
            if dz_id in avoid:
                continue
            artist = int(corpus.artist_ids[i])
            if counts.get(artist, 0) >= per_artist:
                continue
            vec = corpus.matrix[i]
            if any(float(corpus.matrix[corpus.index[c]] @ vec) > 0.96 for c in chosen[-12:]):
                continue
            counts[artist] = counts.get(artist, 0) + 1
            chosen.append(dz_id)
        return chosen

    forced = []
    if include_artists:
        mask = np.isin(corpus.artist_ids, np.array(list(include_artists), dtype=np.int64)) & (keep_new | keep_known)
        forced = pick(mask, min(len(include_artists) * 2, max(2, count // 5)), per_artist=2)
    new = pick(keep_new, n_new, avoid=set(forced))
    known = pick(keep_known, n_known, avoid=set(forced) | set(new))
    ids = forced + new + known
    ids = ids[:count]
    rows = [corpus.index[i] for i in ids]
    energy = _energy_of(dc, rows)
    tempo = _tempo_of(ctx.db, ids)
    ordered = order(ids, energy, tempo, {i: corpus.vec(i) for i in ids},
                    {i: int(corpus.artist_ids[corpus.index[i]]) for i in ids}, shape=shape, target=energy_target)
    pool = [int(corpus.ids[i]) for i in np.argsort(-np.where(keep_new | keep_known, score, -np.inf))[:300]
            if int(corpus.ids[i]) not in set(ids)]
    draft = uuid.uuid4().hex[:12]
    stored = {"params": params, "ids": ordered, "pool": pool, "labels": labels, "shape": shape,
              "energy_target": energy_target}
    ctx.db.x("insert or replace into results_cache(key, value, created, expires) values(?,?,?,?)",
             (f"draft:{draft}", json.dumps(stored), time.time(), time.time() + TTL))
    known_set = set(known)
    extra = build_reasons(ctx, corpus, dc.taste, ordered)
    seed_matrix = np.stack(vecs) if vecs else None
    for dz_id in ordered:
        reasons = extra[f"dz:{dz_id}"]["reasons"]
        if seed_matrix is not None and dc.vec_labels:
            sims = seed_matrix @ corpus.vec(dz_id)
            best = int(np.argmax(sims))
            if best < len(dc.vec_labels):
                label = dc.vec_labels[best]
                text = f"Fits the {label}" if label.endswith("feel") else f"Close to {label}"
                reasons[:] = [r for r in reasons if r["kind"] != "sound"]
                reasons.insert(0, {"kind": "sound", "text": text, "strength": round(float(sims[best]), 3)})
        if dz_id in known_set:
            reasons.insert(0, {"kind": "feedback", "text": "From your library", "strength": 0.4})
    tracks = Catalog(ctx.db).tracks([f"dz:{i}" for i in ordered], extra)
    name = params.get("name") or _suggest_name(labels, params)
    return {"draft": draft, "name": name, "labels": labels, "tracks": tracks,
            "stats": {"new": len(new) + len([f for f in forced if f not in known_ids]), "known": len(known),
                      "energy": [energy.get(i) for i in ordered]}}


def _load(ctx, draft):
    row = ctx.db.one("select value, expires from results_cache where key=?", (f"draft:{draft}",))
    if not row or row["expires"] < time.time():
        return None
    return json.loads(row["value"])


def _save(ctx, draft, stored):
    ctx.db.x("update results_cache set value=?, expires=? where key=?",
             (json.dumps(stored), time.time() + TTL, f"draft:{draft}"))


def replace(ctx, corpus, draft, index, track_ids=None):
    stored = _load(ctx, draft)
    if not stored:
        return None
    ids = [parse_id(t)[1] for t in track_ids] if track_ids else stored["ids"]
    if not 0 <= index < len(ids):
        return None
    current = set(ids)
    prev_vec = corpus.vec(ids[index - 1]) if index > 0 else None
    next_vec = corpus.vec(ids[index + 1]) if index + 1 < len(ids) else None
    old_vec = corpus.vec(ids[index])
    artists = {int(corpus.artist_ids[corpus.index[i]]) for i in ids if i in corpus.index}
    best, best_score = None, -1e9
    for cand in stored["pool"]:
        if cand in current or cand not in corpus.index:
            continue
        artist = int(corpus.artist_ids[corpus.index[cand]])
        if artist in artists:
            continue
        v = corpus.vec(cand)
        s = 0.0
        for neighbor in (prev_vec, next_vec, old_vec):
            if neighbor is not None:
                s += float(v @ neighbor)
        if s > best_score:
            best, best_score = cand, s
    if best is None:
        return None
    ids[index] = best
    stored["ids"] = ids
    stored["pool"] = [p for p in stored["pool"] if p != best]
    _save(ctx, draft, stored)
    extra = build_reasons(ctx, corpus, corpus.taste(), [best])
    return Catalog(ctx.db).tracks([f"dz:{best}"], extra)[0]
