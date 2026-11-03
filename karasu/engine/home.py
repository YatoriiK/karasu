import datetime as dt
import random
from collections import Counter

import numpy as np

from ..util import norm_artist, now, year_of
from . import facets as F
from .catalog import Catalog, _in, tier
from .genres import track_genres


def blocked_sets(db):
    hidden_artists = {r[0] for r in db.q("select value from exclusions where kind='artist'")}
    blocked_tracks = {int(r[0][3:]) for r in db.q("select value from exclusions where kind='track'")
                      if str(r[0]).startswith("dz:")}
    disliked = {r[0] for r in db.q("select dz_id from feedback where kind in ('down', 'never_artist') "
                                   "and dz_id is not null")}
    never = {r[0] for r in db.q("select artist_key from feedback where kind='never_artist' and artist_key is not null")}
    nopreview = {int(r[0].split(":", 1)[1]) for r in db.q("select key from meta where key like 'nopreview:%'")}
    return hidden_artists | never, blocked_tracks | disliked, nopreview


def discovery_mask(corpus, require_preview=True):
    db = corpus.ctx.db
    hidden, blocked, nopreview = blocked_sets(db)
    exclude = corpus.known_ids() | blocked | (nopreview if require_preview else set())
    return corpus.mask(exclude_ids=exclude, exclude_artist_ids=corpus.known_artist_ids(),
                       exclude_artist_keys=hidden)


def fans_by_track(db, dz_ids):
    rows = _in(db, "select t.id, a.fans from dz_tracks t left join dz_artists a on a.id = t.artist_id "
                   "where t.id in ({marks})", dz_ids)
    return {r["id"]: r["fans"] for r in rows}


def sound_reason(corpus, taste, dz_id, labels):
    vec = corpus.vec(dz_id)
    if vec is None or taste is None:
        return None
    sims = taste["vecs"] @ vec
    best = int(np.argmax(sims))
    ref = taste["ids"][best]
    return {"kind": "sound", "text": f"Sounds like {labels.get(ref, 'a song you love')}",
            "strength": round(float(sims[best]), 3), "ref": f"dz:{ref}"}


def track_labels(db, dz_ids):
    rows = _in(db, "select id, title, artist from dz_tracks where id in ({marks})", dz_ids)
    return {r["id"]: f"{r['artist']} – {r['title']}" for r in rows}


def popularity_reason(fans):
    t = tier(fans)
    if t == "underground":
        return {"kind": "popularity", "text": f"Underground · {fans:,} fans", "strength": 0.9}
    if t == "niche":
        return {"kind": "popularity", "text": f"Niche · {fans:,} fans", "strength": 0.6}
    return None


def era_reason(db, dz_id):
    row = db.one("select original_year, year_source, release_date from dz_tracks where id=?", (dz_id,))
    if not row:
        return None
    year = row["original_year"] or year_of(row["release_date"])
    if year and year <= now().year - 15:
        return {"kind": "era", "text": f"From {year}", "strength": 0.5}
    return None


def facet_reason(fvec):
    if fvec is None:
        return None
    labels = F.top_labels(fvec, limit=2, threshold=1.2)
    if labels:
        return {"kind": "facet", "text": " · ".join(labels), "strength": 0.4}
    return None


def build_reasons(ctx, corpus, taste, dz_ids, extra=None):
    db = ctx.db
    fans = fans_by_track(db, dz_ids)
    fac = F.load(db, dz_ids)
    labels = track_labels(db, taste["ids"]) if taste else {}
    out = {}
    for i in dz_ids:
        reasons = []
        for reason in (sound_reason(corpus, taste, i, labels), popularity_reason(fans.get(i)),
                       era_reason(db, i), facet_reason(fac.get(i))):
            if reason:
                reasons.append(reason)
        reasons += (extra or {}).get(i, [])
        out[f"dz:{i}"] = {"reasons": reasons}
    return out


def split_reason(text):
    import re
    out = []
    for part in (p.strip() for p in (text or "").split(" · ")):
        if not part:
            continue
        low = part.lower()
        if low.startswith("sounds like"):
            out.append({"kind": "sound", "text": "Sounds like " + part[12:], "strength": 0.7})
        elif low.startswith("similar to"):
            out.append({"kind": "graph", "text": part[0].upper() + part[1:], "strength": 0.6})
        elif low.startswith("tags:"):
            out.append({"kind": "tag", "text": part[5:].strip().capitalize(), "strength": 0.4})
        elif low.startswith("reissued by"):
            out.append({"kind": "era", "text": part[0].upper() + part[1:], "strength": 0.5})
        elif "discogs" in low or "fans" in low or "listeners" in low:
            out.append({"kind": "popularity", "text": part, "strength": 0.5})
        elif re.fullmatch(r"\d{4}\??", part):
            out.append({"kind": "era", "text": f"From {part.rstrip('?')}", "strength": 0.4})
        else:
            out.append({"kind": "engine", "text": part[0].upper() + part[1:], "strength": 0.3})
    return out


def diverse(corpus, candidates, limit, max_sim=0.93):
    chosen, artists = [], set()
    for dz_id, score in candidates:
        n = corpus.index.get(dz_id)
        if n is None:
            continue
        artist = corpus.artist_ids[n]
        if artist and artist in artists:
            continue
        vec = corpus.matrix[n]
        if any(float(corpus.matrix[corpus.index[c]] @ vec) > max_sim for c, _ in chosen):
            continue
        chosen.append((dz_id, score))
        if artist:
            artists.add(artist)
        if len(chosen) >= limit:
            break
    return chosen


def mix_modes(corpus, taste, candidates, limit):
    if taste is None or len(taste["modes"]) < 2 or not candidates:
        return candidates[:limit]
    rows = [corpus.index[i] for i, _ in candidates]
    assign = (corpus.matrix[rows] @ taste["modes"].T).argmax(axis=1)
    sizes = np.bincount(taste["assign"], weights=taste["weights"], minlength=len(taste["modes"]))
    share = np.sqrt(sizes) / max(np.sqrt(sizes).sum(), 1e-9)
    queues = {}
    for cand, mode in zip(candidates, assign):
        queues.setdefault(int(mode), []).append(cand)
    taken = Counter()
    out = []
    while len(out) < limit and queues:
        mode = max(queues, key=lambda m: share[m] - taken[m] / max(len(out), 1))
        out.append(queues[mode].pop(0))
        taken[mode] += 1
        if not queues[mode]:
            del queues[mode]
    return out


def discover_pool(corpus, taste, keep, fans_cap=20000, limit=200):
    if taste is None:
        return []
    fit = corpus.fit()
    use_fit = fit is not None and len(fit) == len(keep)
    if use_fit:
        score = np.where(keep, fit, -np.inf)
        top = np.argsort(-score)[: limit * 3]
        candidates = [(int(corpus.ids[i]), float(score[i])) for i in top if np.isfinite(score[i])]
    else:
        candidates = corpus.similar(taste["modes"], k=limit * 3, keep=keep)
    fans = fans_by_track(corpus.ctx.db, [c for c, _ in candidates])
    scored = []
    for dz_id, sim in candidates:
        f = fans.get(dz_id)
        if f is not None and f > fans_cap:
            continue
        obscurity = 0.08 if f is None else 0.12 * (1 - min(np.log10(f + 10) / 5, 1))
        scored.append((dz_id, sim + obscurity))
    scored.sort(key=lambda x: -x[1])
    return mix_modes(corpus, taste, scored, limit) if use_fit else scored[:limit]


def similar_to(ctx, corpus, dz_id, limit=8, keep=None):
    vec = corpus.vec(dz_id)
    if vec is None:
        return []
    keep = discovery_mask(corpus) if keep is None else keep
    n = corpus.index.get(dz_id)
    if n is not None:
        keep = keep & (corpus.artist_ids != corpus.artist_ids[n])
    return diverse(corpus, corpus.similar(vec, k=limit * 6, keep=keep), limit)


def recent_ids(db, limit=12):
    rows = db.q("select track_id, max(played_at) at from plays group by track_id order by at desc limit ?", (limit,))
    return Catalog(db).library_ids([r["track_id"] for r in rows])


def top_library_artists(db, limit=8):
    rows = db.q(
        "select a.name, a.norm, sum(s.weight) w from seeds s join sp_artists a on a.id = s.ref "
        "where s.kind like 'artist:%' group by a.norm order by w desc limit ?", (limit,))
    return [dict(r) for r in rows]


def artist_ids_by_name(db, names):
    out = {}
    for name in names:
        row = db.one("select id from dz_artists where norm=? order by fans desc limit 1", (norm_artist(name),))
        if not row:
            row = db.one("select artist_id as id from dz_tracks where key like ? and artist_id is not null limit 1",
                         (norm_artist(name) + "|%",))
        if row and row["id"]:
            out[name] = row["id"]
    return out


def because(ctx, corpus, slot=None):
    taste = corpus.taste()
    if taste is None:
        return None
    db = ctx.db
    lib_artists = {}
    for dz_id in taste["ids"]:
        n = corpus.index.get(dz_id)
        if n is not None and corpus.artist_ids[n]:
            lib_artists.setdefault(int(corpus.artist_ids[n]), []).append(dz_id)
    weights = corpus.library()
    ranked = sorted(((a, ids) for a, ids in lib_artists.items() if len(ids) >= 3),
                    key=lambda x: -sum(weights.get(i, 0) for i in x[1]))[:12]
    if not ranked:
        return None
    slot = slot if slot is not None else now().toordinal() * 3 + now().hour // 8
    artist_id, ids = ranked[slot % len(ranked)]
    vecs = np.stack([corpus.vec(i) for i in ids])
    centroid = vecs.mean(axis=0)
    centroid /= max(np.linalg.norm(centroid), 1e-9)
    keep = discovery_mask(corpus) & (corpus.artist_ids != artist_id)
    near = corpus.similar(centroid, k=80, keep=keep)
    fit = corpus.fit()
    if fit is not None and len(fit) == len(corpus.ids) and near:
        sims = np.array([s for _, s in near])
        fits = np.array([fit[corpus.index[i]] for i, _ in near])
        blend = (sims - sims.mean()) / (sims.std() + 1e-6) + 0.5 * (fits - fits.mean()) / (fits.std() + 1e-6)
        near = [near[k] for k in np.argsort(-blend)]
    picks = diverse(corpus, near, 10)
    name = db.one("select artist from dz_tracks where artist_id=? limit 1", (artist_id,))
    labels = track_labels(db, ids)
    extra = {}
    for dz_id, _ in picks:
        sims = vecs @ corpus.vec(dz_id)
        best = ids[int(np.argmax(sims))]
        extra[dz_id] = [{"kind": "sound", "text": f"Close to {labels.get(best)}",
                         "strength": round(float(sims.max()), 3), "ref": f"dz:{best}"}]
    return {"artist": {"dz_id": artist_id, "name": name[0] if name else None}, "picks": picks, "extra": extra}


def mood(ctx, corpus):
    rows = ctx.db.q("select s.dz_id from plays p join sp_dz s on s.sp_id = p.track_id where s.dz_id > 0 "
                    "order by p.played_at desc limit 40")
    ids = [r[0] for r in rows]
    fac = F.load(ctx.db, ids)
    if len(fac) < 3:
        return None
    mean = np.mean(np.stack(list(fac.values())), axis=0)
    moods = [(F.LABELS[c], float(mean[F.INDEX[c]])) for c in F.IDS if F.GROUP_OF[c] == "mood"]
    moods.sort(key=lambda x: -x[1])
    energy = F.energy_value(mean)
    artist_of =[r["artist_id"] for r in _in(ctx.db, "select artist_id from dz_tracks where id in ({marks})", ids)]
    genre_of = track_genres(ctx.db, artist_of)
    common = Counter(genre_of[a][0] for a in artist_of if genre_of.get(a)).most_common(2)
    genres = [g for g, n in common if n >= 3] or F.top_genres(mean, limit=2, threshold=0.3)
    return {"moods": [m for m, _ in moods[:3]], "energy": energy, "genres": genres, "based_on": len(fac)}


def lanes(ctx):
    out = []
    for lane, name in (("fresh", ctx.cfg["playlists"]["fresh_name"]), ("lost", ctx.cfg["playlists"]["lost_name"])):
        row = ctx.db.one("select sp_id from playlists where lane=?", (lane,))
        ids = [r[0] for r in ctx.db.q("select dz_id from recs where lane=? and removed_at is null "
                                      "order by added_at desc", (lane,))]
        out.append({"id": f"lane:{lane}", "kind": "lane", "lane": lane, "name": name, "sp_id": row[0] if row else None,
                    "count": len(ids), "track_ids": [f"dz:{i}" for i in ids[:4]]})
    for row in ctx.db.q("select id, name, description, sp_id from app_playlists order by updated desc limit 8"):
        ids = [r[0] for r in ctx.db.q("select dz_id from app_playlist_items where playlist_id=? order by pos limit 4",
                                      (row["id"],))]
        count = ctx.db.one("select count(*) from app_playlist_items where playlist_id=?", (row["id"],))[0]
        out.append({"id": f"pl:{row['id']}", "kind": "playlist", "name": row["name"], "description": row["description"],
                    "sp_id": row["sp_id"], "count": count, "track_ids": [f"dz:{i}" for i in ids if i]})
    return out


def part_of_day(hour):
    if hour < 5:
        return "night"
    if hour < 12:
        return "morning"
    if hour < 17:
        return "afternoon"
    if hour < 22:
        return "evening"
    return "night"


def song_payload(ctx, corpus, sotd):
    song = sotd["song"]
    row = ctx.db.one("select md5 from dz_tracks where id=?", (song,))
    if row and row[0]:
        try:
            from .media import palette
            palette(ctx, "cover", row[0])
        except Exception:
            pass
    similar = similar_to(ctx, corpus, song, limit=6)
    ids = [song] + [s for s, _ in similar]
    tracks = Catalog(ctx.db).tracks([f"dz:{i}" for i in ids], build_reasons(ctx, corpus, corpus.taste(), ids))
    return {"track": tracks[0] if tracks else None, "similar": tracks[1:], "date": sotd["date"],
            "another": len(sotd.get("song_history", []))}


def build_home(ctx, corpus):
    catalog = Catalog(ctx.db)
    corpus.refresh()
    taste = corpus.taste()
    user = ctx.db.meta("spotify_user", {}) or {}
    local_hour = dt.datetime.now().hour
    out = {"greeting": {"name": user.get("name"), "part": part_of_day(local_hour)}, "mood": mood(ctx, corpus)}
    from .daily import song_of_day
    sotd = song_of_day(ctx, corpus)
    if sotd.get("song"):
        out["song_of_day"] = song_payload(ctx, corpus, sotd)
    keep = discovery_mask(corpus)
    pool = discover_pool(corpus, taste, keep, fans_cap=12000, limit=120)
    rng = random.Random(f"new:{now().date().isoformat()}")
    head = pool[:60]
    rng.shuffle(head)
    picks = diverse(corpus, head + pool[60:], 12)
    ids = [p for p, _ in picks]
    out["discover"] = catalog.tracks([f"dz:{i}" for i in ids], build_reasons(ctx, corpus, taste, ids))
    bec = because(ctx, corpus)
    if bec:
        ids = [p for p, _ in bec["picks"]]
        out["because"] = {"artist": bec["artist"],
                          "tracks": catalog.tracks([f"dz:{i}" for i in ids],
                                                   build_reasons(ctx, corpus, taste, ids, bec["extra"]))}
    out["recent"] = catalog.tracks(recent_ids(ctx.db, 12))
    out["made_for_you"] = lanes(ctx)
    lane_ids = sorted({t for p in out["made_for_you"] for t in p["track_ids"]})
    out["made_for_you_art"] = {t["id"]: t["art"] for t in catalog.tracks(lane_ids)}
    top = top_library_artists(ctx.db, 8)
    ids = artist_ids_by_name(ctx.db, [a["name"] for a in top])
    artists = {a["dz_id"]: a for a in catalog.artists(list(ids.values()))}
    out["top_artists"] = [artists[ids[a["name"]]] if ids.get(a["name"]) in artists else
                          {"dz_id": None, "name": a["name"], "key": a["norm"], "art": None} for a in top]
    week = (now() - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    plays = ctx.db.q("select artist from listen_events where played_at >= ?", (week,))
    out["activity"] = {"plays_week": len(plays),
                       "artists_week": len({p[0] for p in plays}),
                       "top_week": [a for a, _ in Counter(p[0] for p in plays).most_common(5)]}
    return out
