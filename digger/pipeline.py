import json
import re
import time

from . import gates
from .audio import embed_tracks, model_name
from .graph import crawl
from .lanes import deep_tag_lane, discogs_lane, graph_lane, label_lane, label_matches, lfm_artist, new_release_lane
from .learn import like_scores
from .learn import run as learn_run
from .net import NetError, QuotaExceeded
from .publish import recent_artist_keys, rolling_update, update_outcomes
from .report import write as write_report
from .resolve import Budget, mb_artist_earliest, original_year, spotify_match
from .score import compute, explain
from .select import select
from .sync import known_sets, sync_all
from .taste import build
from .util import now, now_iso


def _progress(ctx, label):
    def show(done, total):
        ctx.log(f"    {label}: {done}/{total}")
    return show


_TITLE_YEAR = re.compile(r"\b(19[0-9]{2}|20[0-9]{2})\b")


def _archival(ctx, c, cutoff):
    if c.label and any(label_matches(c.label, name) for name in ctx.cfg["lost"]["archival_labels"]):
        return True
    years = [int(y) for y in _TITLE_YEAR.findall(c.album or "")]
    return bool(years) and min(years) <= cutoff


def verify(ctx, group, lane):
    cfg = ctx.cfg
    size = int(cfg["lost"]["shortlist"] if lane == "lost" else cfg["selection"]["shortlist"])
    shortlist = sorted(group, key=lambda c: -c.score)[:size]
    this_year = now().year
    budget = Budget(cfg["lost"]["mb_track_checks"])
    out = []
    checked = {}
    for c in shortlist:
        try:
            if lane == "fresh":
                if c.artist_dz and c.artist_dz not in checked:
                    titles = [a.get("title") for a in ctx.dz.artist_albums(c.artist_dz, limit=100)]
                    checked[c.artist_dz] = mb_artist_earliest(ctx, c.artist_dz, c.artist, titles)
                earliest = checked.get(c.artist_dz)
                if earliest and earliest < this_year - int(cfg["fresh"]["debut_max_years"]):
                    continue
            else:
                if c.listeners is None and ctx.lfm.enabled:
                    listeners, playcount, tags = lfm_artist(ctx, c.artist)
                    if listeners is not None:
                        c.listeners, c.playcount, c.tags = listeners, playcount, c.tags or tags
                if c.listeners is not None and c.listeners > cfg["lost"]["listeners_cap"]:
                    continue
                discogs_year = c.year if c.year_source == "discogs" else None
                cutoff = this_year - int(cfg["lost"]["older_than_years"])
                year, source = original_year(ctx, c.dz_id, discogs_year, accept_below=cutoff, budget=budget)
                if year:
                    c.year, c.year_source = year, source
                trusted = c.year_source in ("musicbrainz", "discogs")
                title_years = [int(y) for y in _TITLE_YEAR.findall(c.album or "") if int(y) <= this_year]
                if not trusted and title_years and (c.year is None or min(title_years) < c.year):
                    c.year, c.year_source = min(title_years), "title"
                    trusted = True
                if c.year is not None and c.year <= cutoff:
                    out.append(c)
                    continue
                if trusted:
                    continue
                if c.year is None or c.year > cutoff:
                    if c.source != "labels" or not _archival(ctx, c, cutoff):
                        continue
                    c.year = None
        except NetError as exc:
            ctx.log(f"    verify failed for {c.artist} - {c.title}: {exc}")
            continue
        out.append(c)
    return out


def resolve_spotify(ctx, chosen, n, known_ids):
    found, missing = [], []
    for c in chosen:
        if len(found) >= n:
            break
        try:
            full = ctx.dz.track(c.dz_id) or {}
            match = spotify_match(ctx, full) if full.get("id") else None
        except QuotaExceeded:
            ctx.log("    Spotify quota reached, stopping lookups for this run")
            break
        except NetError as exc:
            ctx.log(f"    lookup failed for {c.artist} - {c.title}: {exc}")
            continue
        if not match:
            missing.append(c)
            continue
        if match["id"] in known_ids:
            continue
        c.sp_uri, c.sp_id = match["uri"], match["id"]
        found.append(c)
    return found, missing


def recommend(ctx, dry_run=False, seed_names=None, sync=True, lanes=("fresh", "lost")):
    cfg, db = ctx.cfg, ctx.db
    started = time.time()
    use_spotify = bool(ctx.sp.configured and ctx.sp.has_login() and not seed_names)
    counts = {}
    if use_spotify and sync:
        ctx.log("Syncing your Spotify library")
        sync_all(ctx.sp, db, log=ctx.log)
        update_outcomes(ctx)
    known = known_sets(db)
    known["artist_dz"] = {r[0] for r in db.q(
        "select distinct d.artist_id from dz_tracks d join sp_dz s on s.dz_id = d.id where d.artist_id is not null")}
    known["rec_artists"] = recent_artist_keys(db)
    ctx.log("Building your taste model")
    taste = build(ctx, seed_artist_names=seed_names, progress=_progress(ctx, "seed audio"))
    if seed_names:
        known["artist_norms"] |= set(taste.artists)
        known["artist_dz"] |= {a["dz_id"] for a in taste.artists.values() if a.get("dz_id")}
    counts["seed tracks embedded"] = len(taste.seed_ids)
    counts["taste modes"] = len(taste.modes)
    counts["taste tags"] = len(taste.tags)
    counts["musicbrainz tags"] = len(taste.mb_tags)
    ctx.log(f"  {len(taste.seed_ids)} seed tracks embedded, {len(taste.modes)} taste modes, "
            f"{len(taste.tags)} Last.fm tags, {len(taste.mb_tags)} MusicBrainz tags")
    if not taste.artists:
        raise RuntimeError("No seed artists found. Run `digger sync` first or pass --seeds.")
    ctx.log("Crawling similar artists")
    g = crawl(ctx, taste, log=ctx.log)
    counts["graph artists"] = len(g.names)
    cands = graph_lane(ctx, g, known, int(cfg["fresh"]["artists_to_check"]), lanes, log=ctx.log)
    cands += deep_tag_lane(ctx, taste, known, g, lanes, log=ctx.log)
    cands += new_release_lane(ctx, taste, known, g, lanes, log=ctx.log)
    if "lost" in lanes:
        cands += label_lane(ctx, known, log=ctx.log)
        cands += discogs_lane(ctx, taste, known, log=ctx.log)
    counts["candidates"] = len(cands)
    kept, stats = gates.apply(cands, known, cfg)
    counts["after filters"] = len(kept)
    ctx.log(f"  {len(cands)} candidates, {len(kept)} after filters ({dict(stats)})")
    ctx.log("Listening to candidates (audio embeddings)")
    embed_tracks(ctx, [(c.dz_id, c.preview) for c in kept], progress=_progress(ctx, "candidate audio"))
    vecs = db.vecs([c.dz_id for c in kept], model=model_name(cfg))
    counts["candidates with audio"] = len(vecs)
    compute(kept, taste, vecs, cfg, like_fn=lambda m: like_scores(db, m))
    n = int(cfg["playlists"]["add_per_week"])
    picks, missing_all = {}, []
    for lane in lanes:
        group = [c for c in kept if c.lane == lane]
        ctx.log(f"Checking the {lane} shortlist ({len(group)} candidates)")
        group = verify(ctx, group, lane)
        counts[f"{lane} verified"] = len(group)
        chosen = select(group, n * 2 if use_spotify else n, cfg, lane, len(taste.modes))
        if use_spotify:
            chosen, missing = resolve_spotify(ctx, chosen, n, known["track_ids"])
            missing_all += missing[:5]
        for c in chosen + missing_all:
            c.reasons = c.reasons or explain(c, taste)
        picks[lane] = chosen
    run_id = db.x("insert into runs(started_at, kind, stats) values(?,?,?)",
                  (now_iso(), "dry" if dry_run else "run", json.dumps(counts))).lastrowid
    if use_spotify and not dry_run:
        ctx.log("Updating your Spotify playlists")
        for lane, chosen in picks.items():
            rolling_update(ctx, lane, chosen, run_id, log=ctx.log)
        learn_run(ctx, log=ctx.log)
    report = write_report(cfg, taste, picks, missing_all, stats, counts, dry_run or not use_spotify)
    ctx.log(f"Done in {time.time() - started:.0f}s. Report: {report}")
    return picks, report
