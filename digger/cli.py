import argparse
import json
import shutil
import subprocess
import sys

from . import CACHE, DATA, HOME, ROOT, config
from .net import NetError

SCHEDULE_PS = r"""
$root = '{root}'
$weekly = New-ScheduledTaskAction -Execute "$root\run.cmd" -WorkingDirectory $root
$daily = New-ScheduledTaskAction -Execute "$root\snapshot.cmd" -WorkingDirectory $root
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName 'Karasu weekly' -Action $weekly -Settings $settings -Principal $principal -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9am) -Force | Out-Null
Register-ScheduledTask -TaskName 'Karasu daily snapshot' -Action $daily -Settings $settings -Principal $principal -Trigger (New-ScheduledTaskTrigger -Daily -At 11pm) -Force | Out-Null
'registered'
"""


def _ctx():
    from .context import Ctx
    return Ctx()


def cmd_doctor(args):
    ok = True

    def line(good, label, detail=""):
        nonlocal ok
        ok = ok and good is not False
        mark = "ok " if good else ("-- " if good is None else "XX ")
        print(f"  [{mark}] {label}{(': ' + detail) if detail else ''}")

    print("Karasu doctor")
    line(sys.version_info >= (3, 11), "python", sys.version.split()[0])
    try:
        import torch
        line(torch.cuda.is_available(), "torch + CUDA",
             f"{torch.__version__}, {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'}")
    except Exception as exc:
        line(False, "torch", str(exc))
    try:
        import soundfile as sf
        line("MP3" in sf.available_formats(), "MP3 decoding", f"libsndfile {sf.__libsndfile_version__}")
    except Exception as exc:
        line(False, "soundfile", str(exc))
    free = shutil.disk_usage(HOME).free / 1e9
    line(free > 10, "disk space", f"{free:.0f} GB free on {HOME.drive}")
    ctx = _ctx()
    cfg = ctx.cfg
    line(bool(cfg["spotify"]["client_id"]) or None, "spotify.client_id", "set" if cfg["spotify"]["client_id"] else "empty")
    line(bool(cfg["lastfm"]["api_key"]) or None, "lastfm.api_key", "set" if cfg["lastfm"]["api_key"] else "empty (graph uses Deezer only)")
    line(bool(cfg["discogs"]["token"]) or None, "discogs.token", "set" if cfg["discogs"]["token"] else "empty (no Discogs crate digging)")
    line(bool(cfg["app"]["contact"]) or None, "app.contact", cfg["app"]["contact"] or "empty (used in the MusicBrainz User-Agent)")
    checks = [
        ("Deezer", lambda: ctx.dz.track_by_isrc("GBAYE0601498")["title"]),
        ("MusicBrainz", lambda: str(len(ctx.mb.isrc_recordings("GBAYE0601498"))) + " recordings"),
    ]
    if ctx.lfm.enabled:
        checks.append(("Last.fm", lambda: f"{ctx.lfm.info('Cocteau Twins')['listeners']} listeners"))
    if ctx.dg.enabled:
        checks.append(("Discogs", lambda: f"{len(ctx.dg.search(type='master', style='Shoegaze', year=1991, per_page=5))} results"))
    if ctx.sp.configured and ctx.sp.has_login():
        checks.append(("Spotify", lambda: f"logged in as {ctx.sp.me().get('display_name')}"))
    elif ctx.sp.configured:
        line(None, "Spotify", "not logged in yet, run: digger auth")
    for name, fn in checks:
        try:
            line(True, name, fn())
        except Exception as exc:
            line(False, name, str(exc)[:160])
    ctx.close()
    print("All good." if ok else "Some checks failed.")
    return 0 if ok else 1


def cmd_auth(args):
    ctx = _ctx()
    me = ctx.sp.login()
    print(f"Logged in to Spotify as {me.get('display_name') or me.get('id')}.")
    ctx.close()


def cmd_sync(args):
    from .sync import sync_all
    ctx = _ctx()
    counts = sync_all(ctx.sp, ctx.db, log=ctx.log)
    print(json.dumps(counts))
    ctx.close()


def cmd_snapshot(args):
    from .publish import update_outcomes
    from .sync import snapshot_recent, snapshot_saved
    ctx = _ctx()
    plays = snapshot_recent(ctx.sp, ctx.db)
    saved = snapshot_saved(ctx.sp, ctx.db)
    changed = update_outcomes(ctx)
    ctx.log(f"snapshot: {plays} new plays, {saved} recent saves checked, {changed} outcomes updated")
    ctx.close()


def cmd_history(args):
    from .sync import import_history
    ctx = _ctx()
    import_history(ctx.db, args.files, log=ctx.log)
    ctx.close()


def cmd_recommend(args, publish=False):
    from .pipeline import recommend
    ctx = _ctx()
    seeds = [s.strip() for s in args.seeds.split(",")] if args.seeds else None
    lanes = tuple(l.strip() for l in args.lanes.split(","))
    try:
        recommend(ctx, dry_run=not publish, seed_names=seeds, sync=not args.no_sync, lanes=lanes)
    finally:
        ctx.close()


def cmd_publish_test(args):
    from .sources.spotify import entry_track
    ctx = _ctx()
    me = ctx.sp.me()
    top = ctx.sp.top("tracks", "short_term", max_items=1) or ctx.sp.saved_tracks(max_items=1)
    track = top[0] if top and "uri" in top[0] else entry_track(top[0]) if top else None
    if not track:
        print("No track to test with.")
        return 1
    pl = ctx.sp.create_playlist("Karasu test", "Test playlist, safe to delete.", False)
    ctx.sp.add_items(pl["id"], [track["uri"]])
    items = [entry_track(e) for e in ctx.sp.playlist_items(pl["id"])]
    good = any(t and t.get("id") == track["id"] for t in items)
    ctx.sp.remove_items(pl["id"], [track["uri"]])
    after = [entry_track(e) for e in ctx.sp.playlist_items(pl["id"])]
    print(f"user: {me.get('display_name')}  wrote: {good}  removed: {not any(after)}")
    try:
        ctx.sp.call("DELETE", f"/playlists/{pl['id']}/followers")
        print("Test playlist removed from your library.")
    except NetError:
        print("Couldn't remove the test playlist automatically; delete 'Karasu test' in Spotify.")
    ctx.close()
    return 0 if good else 1


def cmd_stats(args):
    from .publish import lane_stats
    ctx = _ctx()
    rows = lane_stats(ctx.db)
    if not rows:
        print("No published picks yet.")
    for r in rows:
        heard = (r["played"] or 0) + (r["saved"] or 0)
        rate = f"{(r['saved'] or 0) / heard:.0%}" if heard else "-"
        print(f"  {r['lane']:<6} {r['source']:<10} picks {r['n']:>4}  heard {heard:>4}  saved {r['saved'] or 0:>4}  save rate {rate}")
    ctx.close()


def cmd_serve(args):
    from .web.app import serve
    serve(port=args.port, parent_pid=args.parent_pid, background=not args.no_background)


def cmd_backfill(args):
    from .engine.backfill import first_run
    from .engine.jobs import JobContext

    class Manager:
        cancel_flags = {}
        gpu = __import__("threading").Lock()

        def _update(self, *a, **k):
            stage = k.get("stage")
            if stage and (k.get("done") or 0) % 100 == 0:
                print(f"  {stage}: {k.get('done')}/{k.get('total')}")

    ctx = _ctx()
    jc = JobContext(Manager(), "cli", ctx)
    steps = args.steps.split(",") if args.steps else None
    print(json.dumps(first_run(jc, steps=steps), indent=1))
    from .audio import release_shared
    release_shared()
    ctx.close()


def cmd_schedule(args):
    script = SCHEDULE_PS.replace("{root}", str(ROOT))
    if args.remove:
        names = ["Karasu weekly", "Karasu daily snapshot", "CrateDigger weekly", "CrateDigger daily snapshot"]
        script = "; ".join(f"Unregister-ScheduledTask -TaskName '{n}' -Confirm:$false -ErrorAction SilentlyContinue"
                           for n in names) + "; 'removed'"
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True)
    print(result.stdout.strip() or result.stderr.strip())


def cmd_learn(args):
    from .learn import run
    ctx = _ctx()
    run(ctx, force=args.force, log=ctx.log)
    ctx.close()


def cmd_eval(args):
    from .evaluate import run
    ctx = _ctx()
    run(ctx)
    ctx.close()


def main(argv=None):
    parser = argparse.ArgumentParser(prog="digger", description="Karasu: local music discovery")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").set_defaults(fn=cmd_doctor)
    sub.add_parser("auth").set_defaults(fn=cmd_auth)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)
    sub.add_parser("snapshot").set_defaults(fn=cmd_snapshot)
    p = sub.add_parser("history")
    p.add_argument("files", nargs="+")
    p.set_defaults(fn=cmd_history)
    for name, publish in (("recommend", False), ("run", True)):
        p = sub.add_parser(name)
        p.add_argument("--seeds", help="comma-separated artist names to use instead of your Spotify library")
        p.add_argument("--no-sync", action="store_true")
        p.add_argument("--lanes", default="fresh,lost")
        p.set_defaults(fn=lambda a, publish=publish: cmd_recommend(a, publish))
    sub.add_parser("publish-test").set_defaults(fn=cmd_publish_test)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    sub.add_parser("eval").set_defaults(fn=cmd_eval)
    p = sub.add_parser("learn")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_learn)
    p = sub.add_parser("serve")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--parent-pid", type=int, default=None)
    p.add_argument("--no-background", action="store_true")
    p.set_defaults(fn=cmd_serve)
    p = sub.add_parser("backfill")
    p.add_argument("--steps", default=None, help="comma list: art,map,embed,facets,index,dsp,tags")
    p.set_defaults(fn=cmd_backfill)
    p = sub.add_parser("schedule")
    p.add_argument("--remove", action="store_true")
    p.set_defaults(fn=cmd_schedule)
    args = parser.parse_args(argv)
    from .sources.spotify import AuthError
    try:
        code = args.fn(args)
    except AuthError as exc:
        print(f"Spotify: {exc}")
        code = 2
    sys.exit(code or 0)
