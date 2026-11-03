import asyncio

from fastapi import APIRouter

from ...engine import daily as D
from ...engine.home import song_payload
from ..state import STATE, ctx
from .catalog import _feedback_stamp

router = APIRouter(prefix="/api")


@router.get("/daily")
async def daily():
    c = ctx()

    def run():
        STATE.corpus.refresh()
        date = D.today()
        key = f"daily:{date}:{STATE.corpus.stamp}:{_feedback_stamp(c)}"
        out = dict(STATE.memo(key, 600, lambda: {k: v for k, v in D.build(c, STATE.corpus, date).items()
                                                 if k != "challenge"}))
        out["challenge"] = D.challenge(c, STATE.corpus, date)
        return out

    return await asyncio.to_thread(run)


@router.get("/daily/challenge")
async def daily_challenge():
    c = ctx()
    return await asyncio.to_thread(D.challenge, c, STATE.corpus)


@router.post("/daily/song/another")
async def another_song():
    c = ctx()

    def run():
        picks = D.song_of_day(c, STATE.corpus, another=True)
        STATE.invalidate("home:")
        return song_payload(c, STATE.corpus, picks) if picks.get("song") else None

    return await asyncio.to_thread(run)
