import asyncio

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...audio import shared_clap
from ...engine import home as H
from ...engine import search as S
from ...engine.catalog import Catalog, parse_id
from ..state import STATE, ctx

router = APIRouter(prefix="/api")


def _feedback_stamp(c):
    row = c.db.one("select count(*), coalesce(max(id), 0) from feedback")
    ex = c.db.one("select count(*) from exclusions")
    return f"{row[0]}:{row[1]}:{ex[0]}"


@router.get("/home")
async def home():
    c = ctx()

    def run():
        STATE.corpus.refresh()
        key = f"home:{STATE.corpus.stamp}:{_feedback_stamp(c)}"
        return STATE.memo(key, 300, lambda: H.build_home(c, STATE.corpus))

    return await asyncio.to_thread(run)


@router.get("/search/suggest")
def suggest(q: str = ""):
    return S.suggest(ctx().db, q)


@router.get("/search/live")
async def live_search(q: str = "", remote: bool = False):
    return await asyncio.to_thread(S.live, ctx(), q, remote)


@router.get("/search")
async def search(q: str):
    if not q.strip():
        return {"query": q, "top": None, "tracks": [], "artists": [], "albums": []}
    return await asyncio.to_thread(S.full, ctx(), q.strip())


class Vibe(BaseModel):
    q: str
    limit: int = 30


@router.post("/search/vibe")
async def vibe(body: Vibe):
    c = ctx()
    text = body.q.strip()
    if not text:
        return {"results": []}

    def run():
        corpus = STATE.corpus
        corpus.refresh()
        vec = shared_clap(c.cfg).text([text])[0]
        keep = H.discovery_mask(corpus, require_preview=False)
        hits = H.diverse(corpus, corpus.similar(vec, k=body.limit * 5, keep=keep), body.limit, max_sim=0.97)
        extra = {f"dz:{i}": {"score": s, "reasons": [{"kind": "vibe", "text": f"Matches “{text}”",
                                                     "strength": round(s, 3)}]} for i, s in hits}
        return {"results": Catalog(c.db).tracks([f"dz:{i}" for i, _ in hits], extra)}

    return await asyncio.to_thread(run)


@router.get("/tracks/{track_id}")
async def track(track_id: str):
    c = ctx()
    kind, value = parse_id(track_id)

    def run():
        catalog = Catalog(c.db)
        items = catalog.tracks([track_id])
        if not items:
            raise HTTPException(404, "unknown track")
        out = {"track": items[0], "similar": []}
        if kind == "dz":
            corpus = STATE.corpus
            corpus.refresh()
            sims = H.similar_to(c, corpus, value, limit=10)
            ids = [s for s, _ in sims]
            out["similar"] = catalog.tracks([f"dz:{i}" for i in ids],
                                            H.build_reasons(c, corpus, corpus.taste(), ids))
        return out

    return await asyncio.to_thread(run)


@router.get("/artists/{artist_id}")
async def artist(artist_id: int):
    c = ctx()

    def run():
        from ...engine.search import _store_artist
        from ...net import NetError
        from ...resolve import store_dz_track
        catalog = Catalog(c.db)
        info, top, related, albums = None, [], [], []
        try:
            info = c.dz.artist(artist_id)
            if info and info.get("id"):
                _store_artist(c.db, info)
            top = c.dz.artist_top(artist_id, limit=20)
            related = c.dz.artist_related(artist_id, limit=20)
            albums = c.dz.artist_albums(artist_id, limit=50)
        except NetError:
            pass
        if not info or not info.get("id"):
            if not c.db.one("select 1 from dz_artists where id=?", (artist_id,)):
                raise HTTPException(404, "unknown artist")
        for t in top:
            store_dz_track(c.db, t)
        for a in related:
            if a.get("id"):
                _store_artist(c.db, a)
        corpus = STATE.corpus
        corpus.refresh()
        ids = [t["id"] for t in top if t.get("id")]
        tracks = catalog.tracks([f"dz:{i}" for i in ids])
        art = catalog.artists([artist_id])
        rel = catalog.artists([a["id"] for a in related if a.get("id")])
        known = artist_id in corpus.known_artist_ids()
        lib_ids = [r[0] for r in c.db.q("select s.dz_id from sp_dz s join dz_tracks t on t.id = s.dz_id "
                                        "where t.artist_id=? and s.dz_id > 0", (artist_id,))]
        palettes = {}
        album_items = []
        for al in albums:
            if not al.get("id"):
                continue
            album_items.append({"dz_id": al["id"], "title": al.get("title"),
                                "year": (al.get("release_date") or "")[:4] or None,
                                "type": al.get("record_type"),
                                "art": {"kind": "cover", "ref": al["md5_image"],
                                        "src": f"/api/art/cover/{al['md5_image']}?s=320",
                                        "palette": palettes.get(al["md5_image"])} if al.get("md5_image") else None})
        return {
            "artist": art[0] if art else {"dz_id": artist_id, "name": (info or {}).get("name"), "art": None,
                                         "fans": (info or {}).get("nb_fan"), "tier": None, "key": ""},
            "in_library": known,
            "library_tracks": catalog.tracks([f"dz:{i}" for i in lib_ids[:10]]),
            "top": tracks,
            "related": rel,
            "albums": album_items,
        }

    return await asyncio.to_thread(run)


@router.get("/albums/{album_id}")
async def album(album_id: int):
    c = ctx()

    def run():
        from ...net import NetError
        from ...resolve import store_dz_track
        try:
            data = c.dz.album(album_id)
        except NetError as exc:
            raise HTTPException(502, str(exc))
        if not data or not data.get("id"):
            raise HTTPException(404, "unknown album")
        tracks = (data.get("tracks") or {}).get("data") or []
        for t in tracks:
            store_dz_track(c.db, {**t, "album": {"id": data["id"], "title": data.get("title"),
                                                 "md5_image": data.get("md5_image"),
                                                 "release_date": data.get("release_date")}})
        items = Catalog(c.db).tracks([f"dz:{t['id']}" for t in tracks if t.get("id")])
        md5 = data.get("md5_image")
        return {
            "album": {
                "dz_id": data["id"], "title": data.get("title"), "artist": (data.get("artist") or {}).get("name"),
                "artist_id": (data.get("artist") or {}).get("id"), "label": data.get("label"),
                "year": (data.get("release_date") or "")[:4] or None, "type": data.get("record_type"),
                "fans": data.get("fans"), "duration_s": data.get("duration"),
                "genres": [g.get("name") for g in (data.get("genres") or {}).get("data") or []],
                "art": {"kind": "cover", "ref": md5, "src": f"/api/art/cover/{md5}?s=640", "palette": None} if md5 else None,
            },
            "tracks": items,
        }

    return await asyncio.to_thread(run)


@router.get("/tracks/{track_id}/palette")
async def track_palette(track_id: str):
    from ...engine import media
    c = ctx()
    items = Catalog(c.db).tracks([track_id])
    if not items or not items[0].get("art"):
        return {}
    art = items[0]["art"]
    return await asyncio.to_thread(media.palette, c, art["kind"], art["ref"]) or {}
