import datetime as dt
import json
import random
import threading

import numpy as np

from ..util import norm_artist, year_of
from . import facets as F
from .catalog import Catalog, _in, art_payload
from .discover import Context, _fans_array
from .flow import order
from .media import cached_palettes
from .home import blocked_sets, build_reasons, discover_pool, discovery_mask, diverse

LOCK = threading.Lock()
LOOKBACK = 30


def today():
    return dt.date.today().isoformat()


def day_start_utc(date):
    local = dt.datetime.combine(dt.date.fromisoformat(date), dt.time()).astimezone()
    return local.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _load(db, date):
    row = db.one("select picks from daily where date=?", (date,))
    return json.loads(row[0]) if row else {"date": date}


def _save(db, date, picks):
    db.x("insert or replace into daily(date, picks) values(?,?)", (date, json.dumps(picks)))


def _recent(db, date, key):
    start = (dt.date.fromisoformat(date) - dt.timedelta(days=LOOKBACK)).isoformat()
    out = set()
    for row in db.q("select picks from daily where date >= ? and date < ?", (start, date)):
        value = json.loads(row[0]).get(key)
        if isinstance(value, list):
            out.update(value)
        elif value is not None:
            out.add(value)
    return out


def _weighted(rng, items, power=3.0):
    if not items:
        return None
    weights = [max(score, 0.01) ** power for _, score in items]
    return rng.choices([i for i, _ in items], weights=weights, k=1)[0]


def song_of_day(ctx, corpus, date=None, another=False):
    date = date or today()
    with LOCK:
        picks = _load(ctx.db, date)
        if picks.get("song") and not another:
            return picks
        keep = discovery_mask(corpus)
        pool = discover_pool(corpus, corpus.taste(), keep, fans_cap=15000, limit=60)
        seen = set(picks.get("song_history", [])) | _recent(ctx.db, date, "song")
        if picks.get("song"):
            seen.add(picks["song"])
        fresh = [p for p in pool if p[0] not in seen] or [p for p in pool if p[0] != picks.get("song")]
        song = _weighted(random.Random(f"sotd:{date}:{len(seen)}"), fresh)
        if song is None:
            return picks
        if picks.get("song"):
            picks.setdefault("song_history", []).append(picks["song"])
        picks["song"] = song
        _save(ctx.db, date, picks)
        return picks


def _artist_scores(dc, keep, sims):
    corpus = dc.corpus
    rows_by_artist = {}
    for n in np.flatnonzero(keep):
        artist = int(corpus.artist_ids[n])
        if artist:
            rows_by_artist.setdefault(artist, []).append(int(n))
    rows_by_artist = {a: r for a, r in rows_by_artist.items() if len(r) >= 2}
    fans = {r["id"]: r["fans"] for r in _in(dc.db, "select id, fans from dz_artists where id in ({marks})",
                                             list(rows_by_artist))}
    scored = []
    for artist, rows in rows_by_artist.items():
        top = np.sort(sims[rows])[::-1][:4]
        f = fans.get(artist)
        bonus = 0.05 if f is None else 0.1 * (1 - min(np.log10(f + 10) / 6, 1))
        scored.append((artist, float(top.mean()) + bonus))
    scored.sort(key=lambda x: -x[1])
    return scored, rows_by_artist


def _close_library_artists(dc, vec, limit=2):
    taste = dc.taste
    if taste is None:
        return []
    sims = taste["vecs"] @ vec
    names = []
    rows = _in(dc.db, "select id, artist from dz_tracks where id in ({marks})", taste["ids"])
    artist_of = {r["id"]: r["artist"] for r in rows}
    for k in np.argsort(-sims):
        name = artist_of.get(taste["ids"][int(k)])
        if name and name not in names:
            names.append(name)
        if len(names) >= limit:
            break
    return names


def _pick_artist(dc, keep, sims, rng, avoid):
    scored, rows_by_artist = _artist_scores(dc, keep, sims)
    candidates = [s for s in scored if s[0] not in avoid][:20]
    artist = _weighted(rng, candidates, power=4)
    if artist is None:
        return None
    rows = sorted(rows_by_artist[artist], key=lambda n: -sims[n])
    return {"id": artist, "tracks": [int(dc.corpus.ids[n]) for n in rows[:5]]}


def _pick_album(dc, keep, sims, years, rng, avoid, avoid_artist):
    corpus = dc.corpus
    ids = [int(corpus.ids[n]) for n in np.flatnonzero(keep)]
    rows = _in(dc.db, "select id, album_id, album, artist_id, md5 from dz_tracks where album_id is not null and "
                      "id in ({marks})", ids)
    by_album = {}
    for r in rows:
        if r["artist_id"] == avoid_artist:
            continue
        by_album.setdefault(r["album_id"], []).append(r["id"])
    current = dt.date.today().year
    scored = []
    for album, members in by_album.items():
        if len(members) < 3 or album in avoid:
            continue
        idx = [corpus.index[m] for m in members]
        top = np.sort(sims[idx])[::-1][:3].mean()
        year = int(np.max(years[idx])) or None
        bonus = 0.03 if year and year <= current - 15 else 0.0
        scored.append((album, float(top) + bonus))
    scored.sort(key=lambda x: -x[1])
    album = _weighted(rng, scored[:15], power=4)
    if album is None:
        return None
    members = sorted(by_album[album], key=lambda m: -sims[corpus.index[m]])
    return {"id": album, "tracks": members[:6]}


def _pick_gem(dc, keep, sims, fans, rng, avoid):
    score = np.where(keep & (fans >= 0) & (fans < 2000), sims, -np.inf)
    order_idx = np.argsort(-score)[:60]
    candidates = [(int(dc.corpus.ids[n]), float(score[n])) for n in order_idx
                  if np.isfinite(score[n]) and int(dc.corpus.ids[n]) not in avoid]
    candidates = diverse(dc.corpus, candidates, 15)
    return _weighted(rng, candidates, power=4)


def _pick_mix(ctx, dc, keep, rng, avoid, size=30):
    corpus = dc.corpus
    weights = corpus.library()
    hidden, blocked, nopreview = blocked_sets(ctx.db)
    lib = [i for i in weights if i in corpus.index and i not in blocked and i not in nopreview
           and corpus.artist_keys[corpus.index[i]] not in hidden]
    if not lib:
        return []
    w = np.array([max(weights[i], 0.1) for i in lib], dtype=np.float64)
    nprng = np.random.default_rng(rng.randrange(2 ** 32))
    n_known = min(len(lib), size // 3)
    seeds = [lib[k] for k in nprng.choice(len(lib), size=n_known, replace=False, p=w / w.sum())]
    known, artists = [], set()
    for i in seeds:
        artist = int(corpus.artist_ids[corpus.index[i]])
        if artist in artists:
            continue
        known.append(i)
        artists.add(artist)
    taken = set(avoid) | set(known)
    new = []
    for i in known:
        mask = keep & ~np.isin(corpus.artist_ids, np.array(sorted(artists), dtype=np.int64))
        added = 0
        for dz_id, _ in diverse(corpus, corpus.similar(corpus.vec(i), k=40, keep=mask), 4):
            if dz_id in taken:
                continue
            new.append(dz_id)
            taken.add(dz_id)
            artists.add(int(corpus.artist_ids[corpus.index[dz_id]]))
            added += 1
            if added >= 2:
                break
    ids = (known + new)[:size]
    matrix, present = dc.facets
    energy = {i: F.energy_value(matrix[corpus.index[i]]) if present[corpus.index[i]] else None for i in ids}
    tempo = {r["dz_id"]: r["tempo"] for r in _in(ctx.db, "select dz_id, tempo from dsp where dz_id in ({marks})", ids)}
    return order(ids, energy, tempo, {i: corpus.vec(i) for i in ids},
                 {i: int(corpus.artist_ids[corpus.index[i]]) for i in ids}, shape="wave")


CHALLENGES = ("time_travel", "underground", "new_artists", "genre_detour", "keepers", "instrumental")


def _pick_challenge(dc, rng, date):
    yesterday = (dt.date.fromisoformat(date) - dt.timedelta(days=1)).isoformat()
    last = (_load(dc.db, yesterday).get("challenge") or {}).get("kind")
    kind = rng.choice([c for c in CHALLENGES if c != last])
    out = {"kind": kind}
    if kind == "time_travel":
        years = dc.years
        decades = [d for d in (1960, 1970, 1980, 1990, 2000) if ((years >= d) & (years < d + 10)).sum() >= 40]
        out["decade"] = rng.choice(decades or [1990])
    elif kind == "genre_detour":
        matrix, present = dc.facets
        taste = dc.taste
        lib_rows = [dc.corpus.index[i] for i in taste["ids"]] if taste else []
        options = []
        for cid in F.IDS:
            if F.GROUP_OF[cid] != "genre":
                continue
            j = F.INDEX[cid]
            strong = int((present & (matrix[:, j] > 1.0)).sum())
            mine = float(np.mean(matrix[lib_rows, j] > 1.0)) if lib_rows else 0.0
            if strong >= 60 and mine < 0.06:
                options.append(cid)
        out["genre"] = rng.choice(options) if options else "jazz"
    return out


def _today_events(ctx, date):
    rows = ctx.db.q(
        "select le.artist, le.played_at, coalesce(le.dz_id, s.dz_id) dz_id from listen_events le "
        "left join sp_dz s on s.sp_id = le.sp_id where le.played_at >= ?", (day_start_utc(date),))
    return [dict(r) for r in rows]


def challenge_status(ctx, corpus, date, spec):
    kind = spec["kind"]
    events = _today_events(ctx, date)
    dz_ids = sorted({e["dz_id"] for e in events if e["dz_id"] and e["dz_id"] > 0})
    info = {r["id"]: dict(r) for r in _in(ctx.db, "select t.id, t.original_year, t.release_date, t.artist, a.fans "
                                                  "from dz_tracks t left join dz_artists a on a.id = t.artist_id "
                                                  "where t.id in ({marks})", dz_ids)}
    progress = 0
    if kind == "time_travel":
        d = spec["decade"]
        title, goal = f"Time travel to the {d}s", 3
        body = f"Play 3 songs released in the {d}s."
        action = {"label": f"Explore the {d}s", "to": f"/discover/era?seed={d}&label={d}s"}
        for i in dz_ids:
            y = info.get(i, {}).get("original_year") or year_of(info.get(i, {}).get("release_date"))
            progress += 1 if y and d <= y < d + 10 else 0
    elif kind == "underground":
        title, goal = "Go underground", 3
        body = "Play 3 songs by artists with fewer than 1,000 fans."
        action = {"label": "Find underground artists", "to": "/discover/underground"}
        progress = sum(1 for i in dz_ids if info.get(i, {}).get("fans") is not None and info[i]["fans"] < 1000)
    elif kind == "new_artists":
        title, goal = "Five new voices", 5
        body = "Play songs from 5 artists you've never listened to before."
        action = {"label": "Dig for hidden gems", "to": "/discover/gems"}
        before = {norm_artist(r[0]) for r in ctx.db.q("select distinct artist from listen_events where played_at < ?",
                                                     (day_start_utc(date),))}
        library = {r[0] for r in ctx.db.q("select norm from sp_artists")}
        today_artists = {norm_artist(e["artist"]) for e in events if e["artist"]}
        progress = len(today_artists - before - library)
    elif kind == "genre_detour":
        g = spec["genre"]
        label = F.LABELS.get(g, g)
        title, goal = f"Detour: {label.lower()}", 3
        body = f"Play 3 {label.lower()} songs — a corner of music you rarely visit."
        action = {"label": f"Explore {label.lower()}", "to": f"/discover/genre?seed={g}&label={label}"}
        fac = F.load(ctx.db, dz_ids)
        j = F.INDEX.get(g)
        progress = sum(1 for v in fac.values() if j is not None and len(v) == len(F.IDS) and v[j] > 1.0)
    elif kind == "instrumental":
        title, goal = "No words needed", 3
        body = "Play 3 instrumental songs."
        action = {"label": "Find instrumentals", "to": "/discover/mood?seed=focus&label=Deep focus"}
        fac = F.load(ctx.db, dz_ids)
        j = F.INDEX["instrumental"]
        progress = sum(1 for v in fac.values() if len(v) == len(F.IDS) and v[j] > 1.2)
    else:
        title, goal = "Keepers", 2
        body = "Like 2 songs you'd never heard before today."
        action = {"label": "Start discovering", "to": "/discover/similar"}
        known = corpus.known_ids()
        rows = ctx.db.q("select distinct dz_id from feedback where kind='up' and dz_id is not null and at >= ?",
                        (day_start_utc(date),))
        progress = sum(1 for r in rows if r[0] not in known)
    progress = min(progress, goal)
    return {"kind": kind, "title": title, "body": body, "goal": goal, "progress": progress,
            "done": progress >= goal, "action": action}


def _streak(db, date, done_today):
    streak = 1 if done_today else 0
    day = dt.date.fromisoformat(date)
    for _ in range(365):
        day -= dt.timedelta(days=1)
        picks = _load(db, day.isoformat())
        if not (picks.get("challenge") or {}).get("done"):
            break
        streak += 1
    return streak


def _enrich_artist(ctx, artist_id):
    from .search import _store_artist
    try:
        info = ctx.dz.artist(artist_id)
        if info and info.get("id"):
            _store_artist(ctx.db, info)
    except Exception:
        pass


def _album_meta(ctx, album_id):
    try:
        data = ctx.dz.album(album_id) or {}
    except Exception:
        return {}
    return {"year": year_of(data.get("release_date")), "label": data.get("label"), "type": data.get("record_type"),
            "tracks": data.get("nb_tracks"), "md5": data.get("md5_image"),
            "genres": [g.get("name") for g in (data.get("genres") or {}).get("data") or [] if g.get("name")]}


def ensure_picks(ctx, corpus, date=None):
    date = date or today()
    with LOCK:
        picks = _load(ctx.db, date)
        if all(k in picks for k in ("artist", "album", "gem", "mix", "challenge")):
            return picks
        dc = Context(ctx, corpus)
        if dc.taste is None:
            return picks
        rng = random.Random(f"daily:{date}")
        keep = dc.keep()
        sims = dc.taste_sims()
        fans = _fans_array(dc)
        avoid = {picks.get("song")} - {None}
        if "artist" not in picks:
            artist = _pick_artist(dc, keep, sims, rng, _recent(ctx.db, date, "artist_id"))
            picks["artist"] = artist
            picks["artist_id"] = artist["id"] if artist else None
            if artist:
                _enrich_artist(ctx, artist["id"])
        avoid_artist = picks["artist_id"]
        if "album" not in picks:
            album = _pick_album(dc, keep, sims, dc.years, rng, _recent(ctx.db, date, "album_id"), avoid_artist)
            picks["album"] = album
            picks["album_id"] = album["id"] if album else None
            if album:
                album["meta"] = _album_meta(ctx, album["id"])
        if "gem" not in picks:
            taken = avoid | set((picks.get("artist") or {}).get("tracks", [])) | set((picks.get("album") or {}).get("tracks", []))
            picks["gem"] = _pick_gem(dc, keep, sims, fans, rng, taken | _recent(ctx.db, date, "gem"))
        if "mix" not in picks:
            taken = avoid | {picks.get("gem")} | set((picks.get("artist") or {}).get("tracks", [])) |                 set((picks.get("album") or {}).get("tracks", []))
            picks["mix"] = _pick_mix(ctx, dc, keep, rng, taken)
        if "challenge" not in picks:
            picks["challenge"] = _pick_challenge(dc, rng, date)
        _save(ctx.db, date, picks)
        return picks


def _record_challenge(db, date, done):
    with LOCK:
        picks = _load(db, date)
        challenge = picks.get("challenge") or {}
        if challenge.get("done") == done:
            return
        challenge["done"] = done
        picks["challenge"] = challenge
        _save(db, date, picks)


def challenge(ctx, corpus, date=None):
    date = date or today()
    picks = ensure_picks(ctx, corpus, date)
    spec = picks.get("challenge")
    if not spec:
        return None
    status = challenge_status(ctx, corpus, date, spec)
    if status["done"] != bool(spec.get("done")):
        _record_challenge(ctx.db, date, status["done"])
    status["streak"] = _streak(ctx.db, date, status["done"])
    return status


def mix_payload(ctx, corpus, picks):
    mix = picks.get("mix") or []
    if not mix:
        return None
    known = corpus.known_ids()
    extra = build_reasons(ctx, corpus, corpus.taste(), mix)
    for i in mix:
        if i in known:
            extra[f"dz:{i}"]["reasons"].insert(0, {"kind": "feedback", "text": "From your library", "strength": 0.4})
    tracks = Catalog(ctx.db).tracks([f"dz:{i}" for i in mix], extra)
    return {"title": "Daily Mix", "tracks": tracks, "known": sum(1 for i in mix if i in known),
            "new": sum(1 for i in mix if i not in known)}


def build(ctx, corpus, date=None):
    date = date or today()
    picks = ensure_picks(ctx, corpus, date)
    catalog = Catalog(ctx.db)
    taste = corpus.taste()
    out = {"date": date}
    artist = picks.get("artist")
    if artist:
        info = catalog.artists([artist["id"]])
        ids = [i for i in artist["tracks"] if i in corpus.index]
        if not info and ids:
            row = ctx.db.one("select artist from dz_tracks where id=?", (ids[0],))
            info = [{"dz_id": artist["id"], "name": row[0] if row else None, "key": norm_artist(row[0] if row else ""),
                     "fans": None, "tier": None, "art": None, "first_year": None}]
        if info and ids:
            vec = np.mean(np.stack([corpus.vec(i) for i in ids]), axis=0)
            like = _close_library_artists(Context(ctx, corpus), vec / max(np.linalg.norm(vec), 1e-9))
            tracks = catalog.tracks([f"dz:{i}" for i in ids], build_reasons(ctx, corpus, taste, ids))
            out["artist"] = {**info[0], "tracks": tracks, "like": like,
                             "reason": f"Sounds like {' and '.join(like)}" if like else None}
    album = picks.get("album")
    if album:
        rows = {r["id"]: dict(r) for r in _in(ctx.db, "select id, album, artist, artist_id, md5, original_year, "
                                                      "release_date from dz_tracks where id in ({marks})",
                                              album["tracks"])}
        tracks = catalog.tracks([f"dz:{i}" for i in album["tracks"] if i in rows],
                                build_reasons(ctx, corpus, taste, album["tracks"]))
        if tracks:
            first = rows[album["tracks"][0]]
            meta = album.get("meta") or {}
            years = [r["original_year"] or year_of(r["release_date"]) for r in rows.values()]
            year = min([y for y in years if y], default=None) or meta.get("year")
            art = tracks[0]["art"]
            if meta.get("md5"):
                art = art_payload(("cover", meta["md5"]), cached_palettes(ctx.db, [f"cover:{meta['md5']}"]))
            out["album"] = {"dz_id": album["id"], "title": first["album"], "artist": first["artist"],
                            "artist_id": first["artist_id"], "year": year, "art": art, "label": meta.get("label"),
                            "type": meta.get("type"), "total": meta.get("tracks"), "genres": meta.get("genres", []),
                            "tracks": tracks, "reason": f"{len(tracks)} of its songs sit close to your taste"}
    if picks.get("gem"):
        gem = catalog.tracks([f"dz:{picks['gem']}"], build_reasons(ctx, corpus, taste, [picks["gem"]]))
        out["gem"] = gem[0] if gem else None
    mix = mix_payload(ctx, corpus, picks)
    if mix:
        out["mix"] = mix
    out["challenge"] = challenge(ctx, corpus, date)
    return out
