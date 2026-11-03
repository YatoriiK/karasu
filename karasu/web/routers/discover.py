import asyncio
import json
import time

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...engine import discover as D
from ...engine import explore as X
from ...engine import generator as G
from ...engine import genres as GN
from ...engine.catalog import parse_id
from ..state import STATE, ctx

router = APIRouter(prefix="/api")


@router.get("/discover/options")
def options():
    c = ctx()
    out = D.options()
    gi = GN.index(c, STATE.corpus)
    if gi.names and len(gi.ids) == len(STATE.corpus.ids):
        known = STATE.corpus.known_ids()
        lib = np.fromiter((int(i) in known for i in gi.ids), dtype=bool, count=len(gi.ids))
        sizes = {g: (int((gi.members(g) & lib).sum()), int(gi.members(g).sum())) for g in gi.names}
        named = sorted((g for g in gi.names if sizes[g][1] >= 6), key=lambda g: (-sizes[g][0], -sizes[g][1]))
        out["genres"] = [{"id": k, "label": v["label"]} for k, v in X.SOUNDS.items()]
        out["genres"] += [{"id": GN.slug(g), "label": GN.pretty(g)} for g in named]
    return out


class ModeBody(BaseModel):
    seed: str | None = None
    novelty: float = 0.2
    limit: int = 40
    aspect: str | None = None
    nonce: int | None = None


def _stamp(c):
    row = c.db.one("select count(*), coalesce(max(id), 0) from feedback")
    ex = c.db.one("select count(*) from exclusions")
    return f"{row[0]}:{row[1]}:{ex[0]}"


@router.post("/discover/{mode}")
async def run(mode: str, body: ModeBody):
    if mode not in {m["id"] for m in D.MODES}:
        raise HTTPException(404, "unknown mode")
    c = ctx()

    def go():
        STATE.corpus.refresh()
        key = f"mode:{mode}:{body.seed}:{round(body.novelty, 2)}:{body.limit}:{body.aspect}:{body.nonce}:" \
              f"{STATE.corpus.stamp}:{_stamp(c)}"
        ttl = 0.5 if mode in ("random", "gems") and body.nonce is None else 180
        return STATE.memo(key, ttl, lambda: D.run_mode(c, STATE.corpus, mode, body.seed, body.novelty, body.limit,
                                                         body.aspect, body.nonce))

    return await asyncio.to_thread(go)


class Deeper(BaseModel):
    mode: str
    seed: str | None = None


def _seed_artists(c, corpus, mode, seed):
    dc = D.Context(c, corpus)
    if mode in ("similar",) and seed:
        kind, value = parse_id(seed)
        if kind == "dz":
            row = c.db.one("select artist_id from dz_tracks where id=?", (value,))
            return [row[0]] if row and row[0] else []
    if mode in ("artist", "deep") and seed:
        return [int(str(seed).split(":")[-1])]
    if mode == "genre" and seed:
        member = None
        if seed in X.SOUNDS:
            member = X.sound_strength(dc, X.SOUNDS[seed]["concepts"]) >= X.CUT
        else:
            gi = GN.index(c, corpus)
            name = gi.slugs.get(seed)
            if name and len(gi.ids) == len(corpus.ids):
                member = gi.members(name)
        if member is not None:
            taste = dc.taste_sims()
            rows = sorted(np.flatnonzero(member), key=lambda i: -taste[i])[:60]
            return list(dict.fromkeys(int(corpus.artist_ids[i]) for i in rows if corpus.artist_ids[i]))[:8]
    if mode in ("genre", "mood", "instrumental") and seed:
        concepts = D.ACTIVITIES[seed]["concepts"] if seed in D.ACTIVITIES else [seed]
        score, present = D.concept_score(dc, concepts)
        order = np.argsort(-np.where(present, score, -np.inf))[:40]
        return list({int(corpus.artist_ids[i]) for i in order if corpus.artist_ids[i]})[:8]
    if mode == "era" and seed:
        years = dc.years
        decade = int(seed)
        rows = np.where((years >= decade) & (years < decade + 10))[0]
        taste = dc.taste_sims()
        rows = sorted(rows, key=lambda i: -taste[i])[:40]
        return list({int(corpus.artist_ids[i]) for i in rows if corpus.artist_ids[i]})[:8]
    taste = dc.taste_sims()
    keep = dc.keep()
    rows = np.argsort(-np.where(keep, taste, -np.inf))[:60]
    return list({int(corpus.artist_ids[i]) for i in rows if corpus.artist_ids[i]})[:8]


@router.post("/discover/deeper")
def deeper(body: Deeper):
    c = ctx()
    artists = _seed_artists(c, STATE.corpus, body.mode, body.seed)
    if not artists:
        raise HTTPException(400, "nothing to dig from yet")
    job = STATE.jobs.submit("deepen", D.deepen, {"artist_ids": artists, "track_id": None},
                            key=f"deepen:{body.mode}:{body.seed}", label="Digging deeper")
    return {"job": job, "artists": len(artists)}


@router.post("/tracks/{track_id}/analyze")
def analyze(track_id: str):
    c = ctx()
    kind, value = parse_id(track_id)
    if kind != "dz":
        row = c.db.one("select dz_id from sp_dz where sp_id=? and dz_id > 0", (value,))
        if not row:
            raise HTTPException(400, "this song has no preview to analyze")
        value = row[0]

    def work(jc, dz_id):
        from ...audio import process_tracks, shared_clap, shared_pool
        from ...engine.facets import score_new
        jc.progress("Listening to this song", 0, 1, force=True)
        with jc.gpu():
            done = process_tracks(jc.ctx, [(dz_id, None)], clap=shared_clap(jc.ctx.cfg), pool=shared_pool(jc.ctx.cfg))
        score_new(jc.ctx, [dz_id])
        STATE.corpus.refresh(force=True)
        return {"embedded": done, "id": f"dz:{dz_id}"}

    job = STATE.jobs.submit("analyze", work, {"dz_id": value}, label="Listening to this song")
    return {"job": job, "id": f"dz:{value}"}


class GenerateBody(BaseModel):
    seeds: list[dict] = []
    count: int = 25
    familiarity: float = 0.2
    discovery: float = 0.5
    energy: float | None = None
    shape: str = "steady"
    popularity: str = "any"
    moods: list[str] = []
    genres: list[str] = []
    include_artists: list[str] = []
    exclude_artists: list[str] = []
    name: str | None = None


@router.post("/generate")
async def generate(body: GenerateBody):
    c = ctx()
    params = body.model_dump()

    def go():
        STATE.corpus.refresh()
        return G.generate(c, STATE.corpus, params, nonce=int(time.time() * 1000) % (2 ** 31))

    return await asyncio.to_thread(go)


class ReplaceBody(BaseModel):
    index: int
    track_ids: list[str] | None = None


@router.post("/generate/{draft}/replace")
async def replace(draft: str, body: ReplaceBody):
    c = ctx()
    track = await asyncio.to_thread(G.replace, c, STATE.corpus, draft, body.index, body.track_ids)
    if not track:
        raise HTTPException(404, "no replacement available")
    return {"track": track}


@router.post("/generate/{draft}/regenerate")
async def regenerate(draft: str):
    c = ctx()
    stored = G._load(c, draft)
    if not stored:
        raise HTTPException(404, "This draft expired. Generate it again.")

    def go():
        return G.generate(c, STATE.corpus, stored["params"], nonce=int(time.time() * 1000) % (2 ** 31))

    return await asyncio.to_thread(go)
