from ..audio import model_name, process_tracks, shared_clap, shared_pool
from ..net import NetError
from ..resolve import store_dz_track
from ..util import now_iso

PICK_ARTIST = "pick:artist"
PICK_TRACK = "pick:track"
# Fewer than three artists and the taste model is basically guessing.
MIN_PICKS = 3
MAX_PICKS = 30
TOP_PER_ARTIST = 12
STARTER_ARTISTS = 40
# These lean on MusicBrainz, which allows one request a second. Nobody wants to watch that
# during setup, so they run in the background once the guide is done.
LATER = ("tags", "genres")


def state(db):
    return db.meta("setup", {}) or {}


def update(db, **values):
    db.set_meta("setup", {**state(db), **values})


def has_library(db):
    return bool(db.one("select 1 from seeds where kind like 'track:%' or kind = ? limit 1", (PICK_TRACK,)))


def synced(db):
    return bool(state(db).get("synced_at")) or bool(db.one("select 1 from sp_dz limit 1"))


def picks(db):
    return [int(r[0]) for r in db.q("select ref from seeds where kind = ? order by rowid", (PICK_ARTIST,))]


def save_picks(db, artist_ids):
    with db.tx():
        db.x("delete from seeds where kind in (?, ?)", (PICK_ARTIST, PICK_TRACK))
        for aid in artist_ids:
            db.x("insert into seeds(kind, ref, weight) values(?,?,?)", (PICK_ARTIST, str(int(aid)), 3.0))


def top_artist_ids(db, limit=8):
    rows = db.q(
        "select t.artist_id, sum(x.weight) w from seeds x join sp_dz s on s.sp_id = x.ref "
        "join dz_tracks t on t.id = s.dz_id where x.kind like 'track:%' and t.artist_id is not null "
        "group by t.artist_id order by w desc limit ?", (limit,))
    return [r[0] for r in rows]


def _embed(jc, items, stage):
    db = jc.ctx.db
    have = {r[0] for r in db.q("select dz_id from embeddings where model=?", (model_name(jc.ctx.cfg),))}
    todo = [(i, p) for i, p in items if i not in have]
    if not todo:
        return 0
    with jc.gpu():
        return process_tracks(jc.ctx, todo, clap=shared_clap(jc.ctx.cfg), pool=shared_pool(jc.ctx.cfg),
                              progress=lambda d, t: jc.progress(stage, d, t), cancelled=lambda: jc.cancelled)


def learn_picks(jc):
    from .backfill import first_run
    from .discover import deepen

    ctx = jc.ctx
    db = ctx.db
    artists = picks(db)
    items = []
    jc.progress("Collecting songs by the artists you picked", 0, len(artists), force=True)
    for n, aid in enumerate(artists, 1):
        try:
            top = ctx.dz.artist_top(aid, limit=TOP_PER_ARTIST)
        except NetError:
            top = []
        with db.tx():
            for rank, t in enumerate(top):
                if not t.get("id"):
                    continue
                store_dz_track(db, t)
                db.x("insert or replace into seeds(kind, ref, weight) values(?,?,?)",
                     (PICK_TRACK, str(t["id"]), round(1.5 - rank * 0.06, 3)))
                items.append((t["id"], t.get("preview")))
        jc.progress(None, n, len(artists))
    heard = _embed(jc, items, "Listening to their songs")
    found = deepen(jc, artist_ids=artists, limit_artists=STARTER_ARTISTS)
    first_run(jc, steps=["facets", "index", "covers"])
    update(db, learned_at=now_iso())
    return {"artists": len(artists), "songs": heard, "new": found.get("added", 0)}


def sync_spotify(jc):
    from ..sync import sync_all
    from . import spotify_lib
    from .backfill import STEPS, first_run
    from .discover import deepen

    ctx = jc.ctx
    jc.progress("Reading your Spotify library", 0, 0, force=True)
    sync_all(ctx.sp, ctx.db, log=lambda m: None)
    jc.progress("Reading your playlists", 0, 0, force=True)
    spotify_lib.refresh_playlists(ctx)
    spotify_lib.sync_liked(ctx)
    steps = first_run(jc, steps=[key for key, _, _ in STEPS if key not in LATER])
    artists = top_artist_ids(ctx.db)
    found = deepen(jc, artist_ids=artists, limit_artists=STARTER_ARTISTS) if artists else {}
    update(ctx.db, synced_at=now_iso())
    return {"steps": sorted(steps), "new": found.get("added", 0)}
