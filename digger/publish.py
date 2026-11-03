import json
from datetime import timedelta

from .net import NetError
from .sources.spotify import entry_track
from .util import days_since, now, now_iso

BLURB = {
    "fresh": "New niche artists picked for you",
    "lost": "Older music almost nobody found",
}


def playlist_name(cfg, lane):
    return cfg["playlists"]["fresh_name"] if lane == "fresh" else cfg["playlists"]["lost_name"]


def ensure_playlist(ctx, lane):
    row = ctx.db.one("select sp_id from playlists where lane=?", (lane,))
    if row:
        try:
            if ctx.sp.playlist(row[0]):
                return row[0]
        except NetError as exc:
            if exc.status not in (403, 404):
                raise
    created = ctx.sp.create_playlist(
        playlist_name(ctx.cfg, lane), f"{BLURB[lane]} by Karasu.", ctx.cfg["playlists"]["public"])
    ctx.db.x("insert or replace into playlists(lane, sp_id) values(?,?)", (lane, created["id"]))
    return created["id"]


def update_outcomes(ctx):
    managed = {r[0] for r in ctx.db.q("select sp_id from playlists")}
    wait_days = float(ctx.cfg["playlists"]["unsaved_after_play_days"])
    changed = 0
    for rec in ctx.db.q("select * from recs where sp_id is not null and (outcome is null or outcome in ('played', 'replayed'))"):
        sid = rec["sp_id"]
        saved = ctx.db.one("select 1 from saved where track_id=?", (sid,))
        own = [r[0] for r in ctx.db.q("select playlist_id from playlist_tracks where track_id=?", (sid,)) if r[0] not in managed]
        plays = [r[0] for r in ctx.db.q(
            "select played_at from plays where track_id=? and played_at >= ? order by played_at", (sid, rec["added_at"]))]
        outcome = rec["outcome"]
        if saved or own:
            outcome = "saved"
        elif len(plays) >= 2:
            outcome = "replayed"
        elif plays:
            outcome = "played_not_saved" if (days_since(plays[0]) or 0) >= wait_days else "played"
        if outcome != rec["outcome"]:
            ctx.db.x("update recs set outcome=?, outcome_at=? where id=?", (outcome, now_iso(), rec["id"]))
            changed += 1
    return changed


def rolling_update(ctx, lane, picks, run_id, log=print):
    pcfg = ctx.cfg["playlists"]
    pid = ensure_playlist(ctx, lane)
    entries = ctx.sp.playlist_items(pid)
    current = [t["id"] for t in (entry_track(e) for e in entries) if t and t.get("id")]
    current_set = set(current)
    active = ctx.db.q("select * from recs where lane=? and removed_at is null order by added_at", (lane,))
    remove = []
    for rec in active:
        if rec["sp_id"] not in current_set:
            ctx.db.x("update recs set removed_at=? where id=?", (now_iso(), rec["id"]))
            continue
        age = days_since(rec["added_at"]) or 0
        if rec["outcome"] in ("saved", "played_not_saved") or age > float(pcfg["max_age_days"]):
            remove.append(rec)
    add = [c for c in picks if c.sp_uri and c.sp_id not in current_set][:int(pcfg["add_per_week"])]
    keep_count = len(current) - len(remove)
    overflow = keep_count + len(add) - int(pcfg["max_size"])
    if overflow > 0:
        doomed = {r["id"] for r in remove}
        for rec in active:
            if overflow <= 0:
                break
            if rec["id"] not in doomed and rec["sp_id"] in current_set:
                remove.append(rec)
                doomed.add(rec["id"])
                overflow -= 1
    if remove:
        ctx.sp.remove_items(pid, [f"spotify:track:{r['sp_id']}" for r in remove])
        for rec in remove:
            ctx.db.x("update recs set removed_at=?, outcome=coalesce(outcome, 'unheard') where id=?",
                     (now_iso(), rec["id"]))
    if add:
        ctx.sp.add_items(pid, [c.sp_uri for c in add], position=0)
        stamp = now_iso()
        with ctx.db.tx():
            for c in add:
                ctx.db.x(
                    "insert into recs(run_id, lane, source, dz_id, sp_uri, sp_id, artist, artist_key, title, year, label, "
                    "score, features, reason, added_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (run_id, lane, c.source, c.dz_id, c.sp_uri, c.sp_id, c.artist, c.artist_key, c.title, c.year,
                     c.label, c.score, json.dumps({k: round(v, 4) for k, v in c.feats.items()}), c.reasons, stamp),
                )
    try:
        ctx.sp.update_playlist(pid, f"{BLURB[lane]} by Karasu. {len(add)} new on {now().strftime('%b %d, %Y')}.")
    except NetError:
        pass
    log(f"  {playlist_name(ctx.cfg, lane)}: +{len(add)} new, -{len(remove)} removed")
    return {"playlist": pid, "added": len(add), "removed": len(remove)}


def lane_stats(db):
    rows = db.q(
        "select lane, source, count(*) n, sum(outcome='saved') saved, sum(outcome in ('played', 'replayed', 'played_not_saved')) played, "
        "sum(outcome='played_not_saved') skipped from recs group by lane, source order by lane, source")
    return [dict(r) for r in rows]


def recent_artist_keys(db, days=56):
    since = (now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {r[0] for r in db.q("select artist_key from recs where added_at >= ?", (since,))}
