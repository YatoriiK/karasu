import datetime as dt
import json
import math
from collections import Counter, defaultdict

import numpy as np

from ..util import norm_artist, now, parse_iso, year_of
from . import facets as F
from .catalog import Catalog, _in
from .genres import track_genres
from .home import artist_ids_by_name, diverse

RANGES = {"week": 7, "month": 30, "year": 365, "all": None}
BRIGHT = ["happy", "euphoric", "hopeful", "playful", "warm"]
DARK = ["melancholic", "dark", "lonely", "anxious"]


def _since(days):
    return (now() - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _events(db, start=None, end=None):
    sql = "select * from listen_events where 1=1"
    args = []
    if start:
        sql += " and played_at >= ?"
        args.append(start)
    if end:
        sql += " and played_at < ?"
        args.append(end)
    return [dict(r) for r in db.q(sql + " order by played_at", args)]


def _local(ts):
    d = parse_iso(ts)
    return d.astimezone() if d else None


def _sp_to_dz(db, sp_ids):
    return {r["sp_id"]: r["dz_id"] for r in _in(db, "select sp_id, dz_id from sp_dz where dz_id > 0 and sp_id in ({marks})",
                                                sp_ids)}


def stats(ctx, range_key="month"):
    db = ctx.db
    days = RANGES.get(range_key, 30)
    start = _since(days) if days else None
    events = _events(db, start)
    prev = _events(db, _since(days * 2), start) if days else []
    first_seen = {r["artist"]: r["first"] for r in db.q(
        "select artist, min(played_at) first from listen_events where artist is not null group by artist")}
    lib_artists = {r[0] for r in db.q("select norm from sp_artists")}
    plays = len(events)
    minutes = round(sum((e.get("ms_played") or 0) for e in events) / 60000)
    artists = Counter(e["artist"] for e in events if e.get("artist"))
    tracks = Counter((e.get("artist"), e.get("title"), e.get("sp_id")) for e in events if e.get("title"))
    daily = Counter()
    hours = Counter()
    for e in events:
        d = _local(e["played_at"])
        if d:
            daily[d.date().isoformat()] += 1
            hours[d.hour] += 1
    series = []
    if days and days <= 366:
        today = dt.date.today()
        for k in range(days - 1, -1, -1):
            day = (today - dt.timedelta(days=k)).isoformat()
            series.append({"date": day, "plays": daily.get(day, 0)})
    else:
        series = [{"date": d, "plays": c} for d, c in sorted(daily.items())]
    new_artist_plays = sum(1 for e in events if e.get("artist") and start and first_seen.get(e["artist"], "") >= start
                           and norm_artist(e["artist"]) not in lib_artists)
    new_pct = round(100 * new_artist_plays / plays) if plays else 0
    total_artists = sum(artists.values())
    entropy = -sum((c / total_artists) * math.log(c / total_artists) for c in artists.values()) if total_artists else 0
    diversity = round(100 * entropy / math.log(len(artists))) if len(artists) > 1 else 0
    sp_ids = [t[2] for t in tracks if t[2]]
    dz = _sp_to_dz(db, sp_ids)
    artist_of = {r["id"]: r["artist_id"] for r in _in(db, "select id, artist_id from dz_tracks where id in ({marks})",
                                                       list(dz.values()))}
    genre_of = track_genres(db, list(artist_of.values()))
    genre_counts = Counter()
    for (artist, title, sp_id), count in tracks.items():
        names = genre_of.get(artist_of.get(dz.get(sp_id)))
        if names:
            genre_counts[names[0]] += count
    catalog = Catalog(db)
    top_track_ids = [f"dz:{dz[t[2]]}" if dz.get(t[2]) else f"sp:{t[2]}" for t, _ in tracks.most_common(10) if t[2]]
    top_tracks = catalog.tracks(top_track_ids)
    counts = {f"dz:{dz[t[2]]}" if dz.get(t[2]) else f"sp:{t[2]}": c for t, c in tracks.items() if t[2]}
    for t in top_tracks:
        t["plays"] = counts.get(t["id"], 0)
    names = [a for a, _ in artists.most_common(10)]
    ids = artist_ids_by_name(db, names)
    arts = {a["dz_id"]: a for a in catalog.artists(list(ids.values()))}
    top_artists = []
    for name in names:
        a = arts.get(ids.get(name)) or {"dz_id": None, "name": name, "art": None}
        top_artists.append({**a, "plays": artists[name]})
    streak = 0
    day = dt.date.today()
    discovered_days = set()
    for e in _events(db, _since(60)):
        if e.get("artist") and first_seen.get(e["artist"], "") >= _since(60) and norm_artist(e["artist"]) not in lib_artists:
            d = _local(e["played_at"])
            if d:
                discovered_days.add(d.date())
    rec_days = {_local(r[0]).date() for r in db.q("select added_at from recs where added_at >= ?", (_since(60),)) if r[0]}
    while day in discovered_days or day in rec_days:
        streak += 1
        day -= dt.timedelta(days=1)
    recs = db.one("select count(*), sum(outcome='saved'), sum(outcome in ('played', 'replayed', 'played_not_saved', 'saved')) "
                  "from recs where added_at >= ?", (start or "0",))
    history_rows = db.one("select count(*), min(played_at) from listen_events")
    return {
        "range": range_key,
        "plays": plays,
        "plays_prev": len(prev),
        "minutes": minutes,
        "artists": len(artists),
        "tracks": len(tracks),
        "new_pct": new_pct,
        "diversity": diversity,
        "streak": streak,
        "series": series,
        "hours": [hours.get(h, 0) for h in range(24)],
        "genres": [{"label": g, "plays": c} for g, c in genre_counts.most_common(8)],
        "top_artists": top_artists,
        "top_tracks": top_tracks,
        "discovery": {"picks": recs[0] or 0, "saved": recs[1] or 0, "heard": recs[2] or 0},
        "history": {"events": history_rows[0], "since": history_rows[1]},
    }


def _lib(corpus):
    taste = corpus.taste()
    if taste is None:
        return None, None, None
    return taste["ids"], taste["vecs"], taste["weights"]


def personality(traits, top_genres, top_moods):
    b, e, o, era, adv = (traits[k] for k in ("brightness", "energy", "obscurity", "era_range", "adventurous"))
    adjective = "Melancholic" if b < 40 else "Bright-Eyed" if b > 62 else "Restless" if e > 60 else "Late-Night"
    noun = "Crate Digger" if o >= 55 else "Time Traveler" if era >= 55 else "Explorer" if adv >= 55 else "Loyalist"
    genres = " and ".join(g.lower() for g in top_genres[:2]) or "a little of everything"
    mood = top_moods[0].lower() if top_moods else "varied"
    line = (f"You lean toward {genres}, with a {mood} streak. {o}% of your artists are niche or underground, "
            f"and your music spans {'many decades' if era >= 55 else 'a focused era'}.")
    return {"name": f"The {adjective} {noun}", "description": line}


def profile(ctx, corpus):
    db = ctx.db
    corpus.refresh()
    ids, vecs, weights = _lib(corpus)
    if ids is None:
        return {"empty": True}
    fac = F.load(db, ids)
    rows = [(i, fac[i], w) for i, w in zip(ids, weights) if i in fac]
    if rows:
        mat = np.stack([r[1] for r in rows])
        w = np.array([r[2] for r in rows], dtype=np.float32)
        mean = (mat * w[:, None]).sum(axis=0) / w.sum()
    else:
        mean = np.zeros(len(F.IDS), dtype=np.float32)
    artist_of = {r["id"]: r["artist_id"] for r in _in(db, "select id, artist_id from dz_tracks where id in ({marks})", ids)}
    genre_of = track_genres(db, list(artist_of.values()))
    primary = {i: (genre_of.get(artist_of.get(i)) or [None])[0] for i in ids}
    named = Counter()
    for i, w in zip(ids, weights):
        for k, name in enumerate(genre_of.get(artist_of.get(i)) or []):
            named[name] += float(w) * (1.0 if k == 0 else 0.3)
    total_named = sum(float(w) for i, w in zip(ids, weights) if primary[i]) or 1.0
    genres = [(g, min(1.0, s / total_named)) for g, s in named.most_common()] or sorted(
        ((F.LABELS[c], float(mean[F.INDEX[c]])) for c in F.IDS if F.GROUP_OF[c] == "genre"), key=lambda x: -x[1])
    moods = sorted(((F.LABELS[c], float(mean[F.INDEX[c]])) for c in F.IDS if F.GROUP_OF[c] == "mood"),
                   key=lambda x: -x[1])
    years = {r["id"]: r["original_year"] or year_of(r["release_date"]) for r in
             _in(db, "select id, original_year, release_date from dz_tracks where id in ({marks})", ids)}
    year_list = [y for y in years.values() if y and 1940 <= y <= now().year]
    decades = Counter((y // 10) * 10 for y in year_list)
    fans = [r["fans"] for r in _in(db, "select distinct a.id, a.fans from dz_artists a join dz_tracks t on t.artist_id = a.id "
                                       "where t.id in ({marks}) and a.fans is not null", ids)]
    obscurity = round(100 * sum(1 for f in fans if f < 10000) / len(fans)) if fans else 50
    era_range = round(min(100, (np.std(year_list) / 22) * 100)) if len(year_list) > 3 else 0
    bright = float(np.mean([mean[F.INDEX[c]] for c in BRIGHT]) - np.mean([mean[F.INDEX[c]] for c in DARK]))
    brightness = round(100 / (1 + math.exp(-2.2 * bright)))
    energy = round(100 * (F.energy_value(mean) or 0.5))
    top_g = [g for g, s in genres[:12] if s > 0]
    genre_idx = [F.INDEX[c] for c in F.IDS if F.GROUP_OF[c] == "genre"]
    shares = Counter()
    for _, vec, w in rows:
        if len(vec) == len(F.IDS):
            shares[int(np.argmax(vec[genre_idx]))] += float(w)
    total = sum(shares.values()) or 1.0
    p = np.array([s / total for s in shares.values()]) if shares else np.ones(1)
    effective = math.exp(float(-(p * np.log(p)).sum()))
    adventurous = round(100 * (1 - math.exp(-(effective - 1) / 18)))
    regular_genres = int(sum(1 for s in shares.values() if s / total >= 0.03))
    traits = {"energy": energy, "obscurity": obscurity, "era_range": era_range, "brightness": brightness,
              "adventurous": adventurous}
    person = personality(traits, top_g, [m for m, _ in moods[:3]])
    centered = vecs - vecs.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    axes = vt[:2].T
    proj = centered @ axes
    scale = np.abs(proj).max(axis=0) + 1e-9
    proj = proj / scale
    taste = corpus.taste()
    order = np.argsort(-weights)[:700]
    labels = {r["id"]: (r["title"], r["artist"]) for r in
              _in(db, "select id, title, artist from dz_tracks where id in ({marks})", [ids[i] for i in order])}
    points = [{"x": round(float(proj[i, 0]), 4), "y": round(float(proj[i, 1]), 4), "mode": int(taste["assign"][i]),
               "id": f"dz:{ids[i]}", "title": labels.get(ids[i], ("", ""))[0], "artist": labels.get(ids[i], ("", ""))[1],
               "weight": round(float(weights[i]), 3)} for i in order]
    mode_pos = ((taste["modes"] - vecs.mean(axis=0)) @ axes) / scale
    mode_labels = []
    for m in range(len(taste["modes"])):
        members = [i for i in range(len(ids)) if taste["assign"][i] == m]
        if not members:
            mode_labels.append({"x": 0, "y": 0, "label": "", "size": 0})
            continue
        common = Counter(primary[ids[i]] for i in members if primary[ids[i]]).most_common(1)
        fm = [fac[ids[i]] for i in members if ids[i] in fac]
        label = [common[0][0]] if common else F.top_genres(np.mean(fm, axis=0), limit=1, threshold=-9) if fm else []
        mode_labels.append({"x": round(float(mode_pos[m, 0]), 4), "y": round(float(mode_pos[m, 1]), 4),
                            "label": label[0] if label else f"Mode {m + 1}", "size": len(members)})
    discovered = [r[0] for r in db.q("select dz_id from recs where dz_id is not null order by added_at desc limit 120")]
    found = [(d, corpus.vec(d)) for d in discovered if corpus.vec(d) is not None]
    disc_points = []
    if found:
        dp = ((np.stack([v for _, v in found]) - vecs.mean(axis=0)) @ axes) / scale
        disc_points = [{"x": round(float(dp[k, 0]), 4), "y": round(float(dp[k, 1]), 4), "id": f"dz:{found[k][0]}"}
                       for k in range(len(found))]
    evolution = evolution_series(db, top_g[:3], [m for m, _ in moods[:2]])
    catalog = Catalog(db)
    top_artist_rows = db.q("select a.name, sum(s.weight) w from seeds s join sp_artists a on a.id = s.ref "
                           "where s.kind like 'artist:%' group by a.norm order by w desc limit 12")
    aid = artist_ids_by_name(db, [r["name"] for r in top_artist_rows])
    arts = {a["dz_id"]: a for a in catalog.artists(list(aid.values()))}
    fav_artists = [arts.get(aid.get(r["name"])) or {"dz_id": None, "name": r["name"], "art": None} for r in top_artist_rows]
    top_tracks = catalog.tracks(catalog.library_ids([r[0] for r in db.q(
        "select ref from seeds where kind like 'track:top_%' group by ref order by sum(weight) desc limit 10")]))
    saved_recs = catalog.tracks([f"dz:{r[0]}" for r in db.q(
        "select dz_id from recs where outcome in ('saved', 'replayed') order by outcome_at desc limit 12")])
    liked = catalog.tracks([f"dz:{r[0]}" for r in db.q(
        "select dz_id from feedback where kind='up' and dz_id is not null order by id desc limit 12")])
    return {
        "personality": person,
        "traits": traits,
        "range_genres": regular_genres,
        "genres": [{"label": g, "score": round(s, 3)} for g, s in genres[:10]],
        "moods": [{"label": m, "score": round(s, 3)} for m, s in moods[:8]],
        "decades": [{"decade": d, "count": c} for d, c in sorted(decades.items())],
        "map": {"points": points, "modes": mode_labels, "discovered": disc_points},
        "evolution": evolution,
        "favorite_artists": fav_artists,
        "top_tracks": top_tracks,
        "discovered": (liked + [t for t in saved_recs if t["id"] not in {x["id"] for x in liked}])[:12],
        "library": {"tracks": len(ids), "artists": len(set(corpus.artist_ids[corpus.index[i]] for i in ids))},
    }


def evolution_series(db, genres, moods):
    dims = [("Energy", None)] + [(g, next(c for c in F.IDS if F.LABELS[c] == g)) for g in genres] + \
           [(m, next(c for c in F.IDS if F.LABELS[c] == m)) for m in moods]
    rows = db.q("select s.added_at, d.dz_id from saved s join sp_dz d on d.sp_id = s.track_id where d.dz_id > 0")
    by_q = defaultdict(list)
    for r in rows:
        d = parse_iso(r["added_at"])
        if d:
            by_q[f"{d.year}-Q{(d.month - 1) // 3 + 1}"].append(r["dz_id"])
    fac = F.load(db, [i for ids in by_q.values() for i in ids])
    series = []
    for q in sorted(by_q):
        vecs = [fac[i] for i in by_q[q] if i in fac]
        if len(vecs) < 5:
            continue
        mean = np.mean(np.stack(vecs), axis=0)
        values = {}
        for label, cid in dims:
            values[label] = round(F.energy_value(mean), 3) if cid is None else round(float(mean[F.INDEX[cid]]), 3)
        series.append({"period": q, "count": len(vecs), "values": values})
    return {"dims": [d for d, _ in dims], "series": series[-16:]}


def export_profile(ctx, corpus):
    p = profile(ctx, corpus)
    taste = corpus.taste()
    user = ctx.db.meta("spotify_user", {}) or {}
    return {
        "format": "karasu-profile",
        "version": 1,
        "name": user.get("name") or "A Karasu user",
        "generated": now().strftime("%Y-%m-%d"),
        "personality": p.get("personality"),
        "traits": p.get("traits"),
        "genres": p.get("genres"),
        "moods": p.get("moods"),
        "decades": p.get("decades"),
        "artists": [a["name"] for a in p.get("favorite_artists", [])],
        "centroid": [round(float(v), 4) for v in taste["centroid"]] if taste else None,
    }


def compare(ctx, corpus, theirs):
    mine = export_profile(ctx, corpus)
    g1 = {g["label"]: g["score"] for g in mine.get("genres") or []}
    g2 = {g["label"]: g["score"] for g in theirs.get("genres") or []}
    keys = sorted(set(g1) | set(g2))
    a = np.array([max(g1.get(k, 0), 0) for k in keys])
    b = np.array([max(g2.get(k, 0), 0) for k in keys])
    genre_sim = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)) if keys else 0
    c1, c2 = mine.get("centroid"), theirs.get("centroid")
    centroid_sim = float(np.dot(c1, c2) / (np.linalg.norm(c1) * np.linalg.norm(c2) + 1e-9)) if c1 and c2 else 0
    s1, s2 = {norm_artist(x) for x in mine.get("artists") or []}, {norm_artist(x) for x in theirs.get("artists") or []}
    jaccard = len(s1 & s2) / len(s1 | s2) if s1 | s2 else 0
    parts = []
    if a.any() and b.any():
        parts.append((0.45, genre_sim))
    if c1 and c2:
        parts.append((0.4, min(1.0, max(0.0, (centroid_sim - 0.45) / 0.5))))
    if s1 and s2:
        parts.append((0.15, jaccard))
    score = round(100 * sum(w * v for w, v in parts) / sum(w for w, _ in parts)) if parts else 0
    both = []
    if c1 and c2:
        corpus.refresh()
        v1, v2 = np.array(c1, dtype=np.float32), np.array(c2, dtype=np.float32)
        sims = np.minimum(corpus.matrix @ v1, corpus.matrix @ v2)
        from .home import discovery_mask
        keep = discovery_mask(corpus)
        order = np.argsort(-np.where(keep, sims, -np.inf))[:80]
        picks = diverse(corpus, [(int(corpus.ids[i]), float(sims[i])) for i in order], 12)
        both = Catalog(ctx.db).tracks([f"dz:{i}" for i, _ in picks],
                                      {f"dz:{i}": {"reasons": [{"kind": "sound", "text": "Close to both of your tastes",
                                                                "strength": round(s, 3)}]} for i, s in picks})
    return {
        "score": score,
        "them": {"name": theirs.get("name"), "personality": theirs.get("personality"), "traits": theirs.get("traits")},
        "you": {"name": mine.get("name"), "personality": mine.get("personality"), "traits": mine.get("traits")},
        "shared_artists": sorted(set(mine.get("artists") or []) & set(theirs.get("artists") or []))[:12],
        "shared_genres": [k for k in keys if g1.get(k, 0) > 0.2 and g2.get(k, 0) > 0.2][:8],
        "both_like": both,
    }
