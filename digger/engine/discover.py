import datetime as dt
import random

import numpy as np

from ..util import now, year_of
from . import facets as F
from .catalog import Catalog, _in, parse_id, tier
from .home import build_reasons, discovery_mask, diverse, fans_by_track, mix_modes

MODES = [
    {"id": "similar", "title": "Similar Sounds", "tagline": "Songs that sound like a song you pick", "seed": "track",
     "icon": "audio-waveform"},
    {"id": "artist", "title": "Artist Explorer", "tagline": "Artists in the orbit of one you love", "seed": "artist",
     "icon": "users"},
    {"id": "gems", "title": "Hidden Gems", "tagline": "Underrated songs that fit your taste", "seed": None,
     "icon": "gem"},
    {"id": "deep", "title": "Deep Cuts", "tagline": "Lesser-known songs from artists you already like",
     "seed": "artist?", "icon": "disc-3"},
    {"id": "genre", "title": "Genre Explorer", "tagline": "Dive into a genre or subgenre", "seed": "genre",
     "icon": "tags"},
    {"id": "mood", "title": "Mood", "tagline": "Music for how you feel right now", "seed": "mood",
     "icon": "cloud-sun"},
    {"id": "random", "title": "Surprise Me", "tagline": "Something completely different, still good",
     "seed": None, "icon": "dice-5"},
    {"id": "era", "title": "Era Explorer", "tagline": "Travel to a decade", "seed": "decade",
     "icon": "calendar-clock"},
    {"id": "instrumental", "title": "Sound & Instruments", "tagline": "Find music by instrument and texture",
     "seed": "instrument", "icon": "piano"},
    {"id": "underground", "title": "Underground", "tagline": "Small, independent artists close to your sound",
     "seed": None, "icon": "radio-tower"},
]

ACTIVITIES = {
    "focus": {"label": "Deep focus", "concepts": ["instrumental", "chill", "minimal"], "energy": 0.3},
    "workout": {"label": "Workout", "concepts": ["energetic", "intense", "aggressive"], "energy": 0.85},
    "late_night": {"label": "Late night", "concepts": ["dark", "chill", "lonely"], "energy": 0.35},
    "party": {"label": "Party", "concepts": ["danceable", "euphoric", "happy"], "energy": 0.8},
    "sleep": {"label": "Wind down", "concepts": ["very_calm", "peaceful", "dreamy"], "energy": 0.15},
    "road_trip": {"label": "Road trip", "concepts": ["happy", "hopeful", "energetic"], "energy": 0.65},
    "rainy_day": {"label": "Rainy day", "concepts": ["melancholic", "nostalgic", "warm"], "energy": 0.35},
    "cooking": {"label": "Cooking", "concepts": ["warm", "playful", "danceable"], "energy": 0.55},
}


def options():
    groups = {}
    for group, cid, label, _ in F.VOCAB:
        groups.setdefault(group, []).append({"id": cid, "label": label})
    decades = [{"id": str(d), "label": f"{d}s"} for d in range(1950, (now().year // 10) * 10 + 1, 10)]
    return {
        "modes": MODES,
        "genres": groups.get("genre", []),
        "moods": groups.get("mood", []) + [g for g in groups.get("energy", [])],
        "instruments": groups.get("instrument", []) + [g for g in groups.get("production", [])] +
                       [g for g in groups.get("vocals", [])],
        "decades": decades,
        "activities": [{"id": k, "label": v["label"]} for k, v in ACTIVITIES.items()],
    }


class Context:
    def __init__(self, ctx, corpus):
        self.ctx = ctx
        self.db = ctx.db
        self.corpus = corpus
        corpus.refresh()
        self.taste = corpus.taste()
        self._facets = None
        self._years = None
        self._fit = None

    @property
    def facets(self):
        if self._facets is None:
            loaded = F.load(self.db)
            matrix = np.zeros((len(self.corpus.ids), len(F.IDS)), dtype=np.float32)
            present = np.zeros(len(self.corpus.ids), dtype=bool)
            for n, dz_id in enumerate(self.corpus.ids):
                vec = loaded.get(int(dz_id))
                if vec is not None and len(vec) == len(F.IDS):
                    matrix[n] = vec
                    present[n] = True
            self._facets = (matrix, present)
        return self._facets

    @property
    def years(self):
        if self._years is None:
            rows = _in(self.db, "select id, original_year, release_date from dz_tracks where id in ({marks})",
                       [int(i) for i in self.corpus.ids])
            by_id = {r["id"]: r["original_year"] or year_of(r["release_date"]) for r in rows}
            self._years = np.array([by_id.get(int(i)) or 0 for i in self.corpus.ids], dtype=np.int32)
        return self._years

    def taste_sims(self):
        if self.taste is None or len(self.corpus.ids) == 0:
            return np.zeros(len(self.corpus.ids), dtype=np.float32)
        if self._fit is None:
            fit = self.corpus.fit()
            self._fit = fit if fit is not None and len(fit) == len(self.corpus.ids) else False
        if self._fit is not False:
            return self._fit
        return (self.corpus.matrix @ self.taste["modes"].T).max(axis=1)

    def excluded_genre_mask(self):
        genres = [r[0] for r in self.db.q("select value from exclusions where kind='genre'")]
        if not genres:
            return np.ones(len(self.corpus.ids), dtype=bool)
        matrix, present = self.facets
        keep = np.ones(len(self.corpus.ids), dtype=bool)
        for g in genres:
            if g in F.INDEX:
                keep &= ~(present & (matrix[:, F.INDEX[g]] > 1.5))
        return keep

    def keep(self, require_preview=True):
        return discovery_mask(self.corpus, require_preview) & self.excluded_genre_mask()


def _fans_array(dc):
    fans = fans_by_track(dc.db, [int(i) for i in dc.corpus.ids])
    return np.array([fans.get(int(i)) if fans.get(int(i)) is not None else -1 for i in dc.corpus.ids], dtype=np.int64)


def _rank(dc, score, keep, limit, max_sim=0.93, balance=False):
    score = np.where(keep, score, -np.inf)
    order = np.argsort(-score)
    candidates = [(int(dc.corpus.ids[i]), float(score[i])) for i in order[: limit * 8] if np.isfinite(score[i])]
    if balance:
        candidates = mix_modes(dc.corpus, dc.taste, candidates, limit * 4)
    return diverse(dc.corpus, candidates, limit, max_sim=max_sim)


def _z(x):
    x = np.asarray(x, dtype=np.float32)
    finite = np.isfinite(x)
    if not finite.any():
        return np.zeros_like(x)
    mu, sd = x[finite].mean(), x[finite].std() + 1e-6
    return np.where(finite, (x - mu) / sd, 0.0)


def concept_score(dc, concept_ids):
    matrix, present = dc.facets
    idx = [F.INDEX[c] for c in concept_ids if c in F.INDEX]
    if not idx:
        return np.zeros(len(dc.corpus.ids), dtype=np.float32), present
    return matrix[:, idx].mean(axis=1), present


def payload(dc, picks, extra_reasons=None, meta=None):
    ids = [p for p, _ in picks]
    extra = build_reasons(dc.ctx, dc.corpus, dc.taste, ids, extra_reasons)
    for dz_id, score in picks:
        extra.setdefault(f"dz:{dz_id}", {})["score"] = round(score, 4)
    return {"items": Catalog(dc.db).tracks([f"dz:{i}" for i in ids], extra), "meta": meta or {}}


STYLE_GROUPS = ("genre", "mood", "production", "era")
STYLE_IDX = [F.INDEX[c] for c in F.IDS if F.GROUP_OF[c] in STYLE_GROUPS]


def style_coherence(dc, dz_id=None, rows=None):
    matrix, present = dc.facets
    if rows is None:
        n = dc.corpus.index.get(int(dz_id))
        if n is None or not present[n]:
            return np.zeros(len(dc.corpus.ids), dtype=np.float32)
        ref = matrix[n, STYLE_IDX]
    else:
        rows = [r for r in rows if present[r]]
        if not rows:
            return np.zeros(len(dc.corpus.ids), dtype=np.float32)
        ref = matrix[rows][:, STYLE_IDX].mean(axis=0)
    sub = matrix[:, STYLE_IDX]
    out = (sub @ ref) / (np.linalg.norm(sub, axis=1) * (np.linalg.norm(ref) + 1e-6) + 1e-6)
    return np.where(present, out, 0.0).astype(np.float32)


def mode_similar(dc, seed, novelty, limit, aspect=None):
    kind, value = parse_id(seed)
    if kind != "dz":
        row = dc.db.one("select dz_id from sp_dz where sp_id=? and dz_id > 0", (value,))
        if not row:
            return {"items": [], "meta": {"needs_embedding": True}}
        value = row[0]
    vec = dc.corpus.vec(value)
    if vec is None:
        return {"items": [], "meta": {"needs_embedding": True, "seed": f"dz:{value}"}}
    sims = dc.corpus.matrix @ vec
    score = _z(sims) + 0.6 * _z(style_coherence(dc, value))
    reason_note = None
    if aspect and aspect in F.ASPECTS:
        matrix, present = dc.facets
        n = dc.corpus.index.get(int(value))
        if n is not None and present[n]:
            idx = [F.INDEX[c] for c in F.ASPECTS[aspect]]
            seed_aspect = matrix[n, idx]
            sub = matrix[:, idx]
            norms = np.linalg.norm(sub, axis=1) * (np.linalg.norm(seed_aspect) + 1e-6) + 1e-6
            aspect_sim = (sub @ seed_aspect) / norms
            score = 0.45 * _z(sims) + 0.55 * _z(aspect_sim)
            reason_note = {"guitar": "Similar guitar tone", "drums": "Similar drums & groove",
                           "vocals": "Similar vocal style", "atmosphere": "Similar atmosphere",
                           "production": "Similar production", "instruments": "Similar instrumentation"}[aspect]
    if novelty > 0:
        score = score - novelty * 0.3 * _z(dc.taste_sims())
    keep = dc.keep()
    n = dc.corpus.index.get(int(value))
    if n is not None:
        keep &= dc.corpus.artist_ids != dc.corpus.artist_ids[n]
    picks = _rank(dc, score, keep, limit)
    seed_row = dc.db.one("select title, artist from dz_tracks where id=?", (value,))
    label = f"{seed_row['artist']} – {seed_row['title']}" if seed_row else "your pick"
    extra = {}
    for dz_id, _ in picks:
        sim = float(dc.corpus.vec(dz_id) @ vec)
        reasons = [{"kind": "sound", "text": f"Sounds like {label}", "strength": round(sim, 3), "ref": f"dz:{value}"}]
        if reason_note:
            reasons.insert(0, {"kind": "facet", "text": f"{reason_note} · approximate", "strength": 0.5})
        extra[dz_id] = reasons
    return payload(dc, picks, {k: v for k, v in extra.items()},
                   {"title": f"Sounds like {seed_row['title'] if seed_row else 'your pick'}", "seed": f"dz:{value}",
                    "aspect": aspect})


def _artist_rows(dc, artist_id):
    return [n for n, a in enumerate(dc.corpus.artist_ids) if int(a) == int(artist_id)]


def mode_artist(dc, seed, novelty, limit):
    artist_id = int(str(seed).split(":")[-1])
    rows = _artist_rows(dc, artist_id)
    name_row = dc.db.one("select name from dz_artists where id=?", (artist_id,)) or \
        dc.db.one("select artist as name from dz_tracks where artist_id=? limit 1", (artist_id,))
    name = name_row["name"] if name_row else "this artist"
    related = []
    try:
        related = [a for a in dc.ctx.dz.artist_related(artist_id, limit=25) if a.get("id")]
    except Exception:
        related = []
    related_ids = {a["id"] for a in related}
    keep = dc.keep() & (dc.corpus.artist_ids != artist_id)
    if rows:
        centroid = dc.corpus.matrix[rows].mean(axis=0)
        centroid /= max(np.linalg.norm(centroid), 1e-9)
        sims = dc.corpus.matrix @ centroid
    else:
        sims = np.zeros(len(dc.corpus.ids), dtype=np.float32)
    boost = np.array([0.6 if int(a) in related_ids else 0.0 for a in dc.corpus.artist_ids], dtype=np.float32)
    coherence = style_coherence(dc, rows=rows) if rows else np.zeros(len(dc.corpus.ids), dtype=np.float32)
    score = _z(sims) + 0.6 * _z(coherence) + boost - (novelty * 0.25 * _z(dc.taste_sims()) if novelty else 0)
    picks = _rank(dc, score, keep, limit, max_sim=0.97)
    extra = {}
    for dz_id, _ in picks:
        n = dc.corpus.index[dz_id]
        reasons = []
        if int(dc.corpus.artist_ids[n]) in related_ids:
            reasons.append({"kind": "graph", "text": f"Fans of {name} also listen", "strength": 0.7})
        if rows:
            reasons.append({"kind": "sound", "text": f"Close to {name}'s sound", "strength": round(float(sims[n]), 3)})
        extra[dz_id] = reasons
    out = payload(dc, picks, extra, {"title": f"In the orbit of {name}", "seed": f"artist:{artist_id}"})
    out["artists"] = Catalog(dc.db).artists([a["id"] for a in related[:16]])
    return out


def mode_gems(dc, novelty, limit, fans_cap=2500):
    fans = _fans_array(dc)
    taste = dc.taste_sims()
    obscurity = np.where(fans >= 0, 1 - np.clip(np.log10(fans + 10) / 4.5, 0, 1), 0.55)
    score = _z(taste) * (1 - novelty * 0.6) + 0.6 * _z(obscurity) + novelty * 0.4 * np.random.default_rng().normal(size=len(taste))
    keep = dc.keep() & ((fans < 0) | (fans <= fans_cap))
    picks = _rank(dc, score, keep, limit, balance=True)
    return payload(dc, picks, meta={"title": "Hidden gems", "subtitle": "Little-known songs that fit your taste"})


def mode_deep(dc, seed, novelty, limit):
    known_artists = dc.corpus.known_artist_ids()
    lib = set(dc.corpus.known_ids())
    if seed:
        artist_ids = {int(str(seed).split(":")[-1])}
    else:
        artist_ids = known_artists
    hidden = {r[0] for r in dc.db.q("select value from exclusions where kind='artist'")}
    keep = np.array([int(a) in artist_ids and int(i) not in lib for a, i in zip(dc.corpus.artist_ids, dc.corpus.ids)],
                    dtype=bool)
    keep &= np.array([k not in hidden for k in dc.corpus.artist_keys], dtype=bool)
    ranks = {r["id"]: r["rank"] for r in _in(dc.db, "select id, rank from dz_tracks where id in ({marks})",
                                              [int(i) for i in dc.corpus.ids[keep]])}
    rank_arr = np.array([ranks.get(int(i)) or 0 for i in dc.corpus.ids], dtype=np.float64)
    obscurity = -_z(np.log10(rank_arr + 10))
    score = _z(dc.taste_sims()) + 0.5 * obscurity
    picks = _rank(dc, score, keep, limit, max_sim=0.98)
    extra = {dz_id: [{"kind": "feedback", "text": "By an artist you already love", "strength": 0.6}] for dz_id, _ in picks}
    return payload(dc, picks, extra, {"title": "Deep cuts", "subtitle": "Lesser-known songs by artists you know",
                                      "seed": seed})


def mode_concept(dc, concept_ids, novelty, limit, title, reason_text):
    score_c, present = concept_score(dc, concept_ids)
    taste = dc.taste_sims()
    score = score_c + (1 - novelty) * 0.8 * _z(taste)
    keep = dc.keep() & present & (score_c > 0.4)
    picks = _rank(dc, score, keep, limit)
    extra = {dz_id: [{"kind": "facet", "text": reason_text, "strength": 0.6}] for dz_id, _ in picks}
    return payload(dc, picks, extra, {"title": title})


def mode_genre(dc, key, novelty, limit):
    from . import explore as X
    from . import genres as G

    if key in X.SOUNDS:
        spec = X.SOUNDS[key]
        strength = X.sound_strength(dc, spec["concepts"])
        member, rank, label = strength >= X.CUT, strength, spec["label"]
        reason = lambda row: {"kind": "facet", "text": f"{spec['reason']} · from the audio", "strength": 0.6}
    else:
        gi = G.index(dc.ctx, dc.corpus)
        name = gi.slugs.get(key)
        if name is None or len(gi.ids) != len(dc.corpus.ids):
            return None
        member, rank, label = gi.members(name), gi.rank[:, gi.col[name]], G.pretty(name)
        reason = lambda row: ({"kind": "tag", "text": f"Tagged {name} on MusicBrainz", "strength": 0.7}
                              if gi.tagged[row] else {"kind": "sound", "text": f"Sounds like {name} · estimated",
                                                      "strength": 0.4})
    score = (1 - novelty) * 0.9 * _z(dc.taste_sims()) + 0.6 * _z(rank)
    picks = _rank(dc, score, dc.keep() & member, limit)
    extra = {dz_id: [reason(dc.corpus.index[dz_id])] for dz_id, _ in picks}
    return payload(dc, picks, extra, {"title": label, "subtitle": "Ranked by how well each song fits your taste"})


def mode_random(dc, limit, seed=None):
    rng = np.random.default_rng(seed)
    taste = dc.taste_sims()
    fans = _fans_array(dc)
    keep = dc.keep() & ((fans < 0) | (fans >= 30))
    far = -_z(taste)
    score = far + rng.normal(scale=0.9, size=len(taste))
    picks = _rank(dc, score, keep, limit, max_sim=0.85)
    extra = {dz_id: [{"kind": "engine", "text": "Outside your usual sound — on purpose", "strength": 0.3}]
             for dz_id, _ in picks}
    return payload(dc, picks, extra, {"title": "Surprise me", "subtitle": "Far from your usual — but chosen for quality"})


def mode_era(dc, decade, novelty, limit):
    decade = int(decade)
    years = dc.years
    in_decade = (years >= decade) & (years < decade + 10)
    era_concept = {1960: "era_60s", 1970: "era_70s", 1980: "era_80s", 1990: "era_90s", 2000: "era_00s"}.get(decade)
    score = (1 - novelty) * _z(dc.taste_sims())
    if era_concept:
        c, present = concept_score(dc, [era_concept])
        score = score + 0.4 * np.where(present, c, 0)
    keep = dc.keep() & in_decade
    picks = _rank(dc, score, keep, limit)
    extra = {}
    for dz_id, _ in picks:
        y = int(years[dc.corpus.index[dz_id]])
        extra[dz_id] = [{"kind": "era", "text": f"Released {y}", "strength": 0.6}]
    return payload(dc, picks, extra, {"title": f"The {decade}s", "subtitle": "Older songs that fit your taste"})


def mode_underground(dc, novelty, limit):
    fans = _fans_array(dc)
    years = dc.years
    recent = years >= now().year - 4
    score = _z(dc.taste_sims()) * (1 - 0.4 * novelty) + 0.4 * _z(-np.log10(np.where(fans >= 0, fans, 500) + 10))
    keep = dc.keep() & (fans >= 0) & (fans <= 3000) & recent
    picks = _rank(dc, score, keep, limit, balance=True)
    return payload(dc, picks, meta={"title": "Underground", "subtitle": "Small, recent artists close to your sound"})


def run_mode(ctx, corpus, mode, seed=None, novelty=0.2, limit=40, aspect=None, nonce=None):
    dc = Context(ctx, corpus)
    novelty = float(min(max(novelty or 0, 0), 1))
    limit = int(min(max(limit or 40, 5), 120))
    if mode == "similar":
        if not seed:
            return {"items": [], "meta": {"needs_seed": "track"}}
        return mode_similar(dc, seed, novelty, limit, aspect)
    if mode == "artist":
        if not seed:
            return {"items": [], "meta": {"needs_seed": "artist"}}
        return mode_artist(dc, seed, novelty, limit)
    if mode == "gems":
        return mode_gems(dc, novelty, limit)
    if mode == "deep":
        return mode_deep(dc, seed, novelty, limit)
    if mode == "genre":
        if seed:
            picked = mode_genre(dc, seed, novelty, limit)
            if picked is not None:
                return picked
        cid = seed if seed in F.INDEX else "indie_rock"
        return mode_concept(dc, [cid], novelty, limit, F.LABELS.get(cid, cid), f"Sounds like {F.LABELS.get(cid, cid).lower()}")
    if mode == "mood":
        if seed in ACTIVITIES:
            a = ACTIVITIES[seed]
            return mode_concept(dc, a["concepts"], novelty, limit, a["label"], f"Fits {a['label'].lower()}")
        cid = seed or "chill"
        return mode_concept(dc, [cid], novelty, limit, F.LABELS.get(cid, cid), f"Feels {F.LABELS.get(cid, cid).lower()}")
    if mode == "instrumental":
        cid = seed or "guitar_clean"
        return mode_concept(dc, [cid], novelty, limit, F.LABELS.get(cid, cid), f"Features {F.LABELS.get(cid, cid).lower()}")
    if mode == "random":
        return mode_random(dc, limit, seed=nonce)
    if mode == "era":
        return mode_era(dc, seed or "1990", novelty, limit)
    if mode == "underground":
        return mode_underground(dc, novelty, limit)
    raise ValueError(f"unknown mode {mode}")


def deepen(jc, artist_ids=None, track_id=None, decade=None, limit_artists=30):
    from ..audio import process_tracks, shared_clap, shared_pool
    from ..resolve import store_dz_track
    from .facets import score_new
    from .search import _store_artist

    ctx = jc.ctx
    seeds = set(int(a) for a in (artist_ids or []))
    if track_id:
        kind, value = parse_id(track_id)
        if kind == "dz":
            row = ctx.db.one("select artist_id from dz_tracks where id=?", (value,))
            if row and row[0]:
                seeds.add(int(row[0]))
    frontier = list(seeds)
    found_artists = set()
    jc.progress("Finding related artists", 0, len(frontier) or 1, force=True)
    for n, aid in enumerate(frontier, 1):
        try:
            for a in ctx.dz.artist_related(aid, limit=15):
                if a.get("id"):
                    _store_artist(ctx.db, a)
                    found_artists.add(a["id"])
        except Exception:
            pass
        jc.progress("Finding related artists", n, len(frontier))
    known = {r[0] for r in ctx.db.q("select distinct t.artist_id from dz_tracks t join sp_dz s on s.dz_id = t.id "
                                    "union select cast(ref as integer) from seeds where kind = 'pick:artist'")
             if r[0]}
    targets = [a for a in found_artists if a not in known][:limit_artists]
    new_tracks = []
    for n, aid in enumerate(targets, 1):
        try:
            for t in ctx.dz.artist_top(aid, limit=5):
                if t.get("id") and t.get("preview"):
                    store_dz_track(ctx.db, t)
                    new_tracks.append((t["id"], t.get("preview")))
        except Exception:
            pass
        jc.progress("Collecting their songs", n, len(targets))
    if decade:
        jc.progress("Searching the era", 0, 1, force=True)
    if not new_tracks:
        return {"added": 0}
    with jc.gpu():
        done = process_tracks(ctx, new_tracks, clap=shared_clap(ctx.cfg), pool=shared_pool(ctx.cfg),
                              progress=lambda d, t: jc.progress("Listening to new songs", d, t),
                              cancelled=lambda: jc.cancelled)
    score_new(ctx, [i for i, _ in new_tracks])
    return {"added": done, "artists": len(targets)}
