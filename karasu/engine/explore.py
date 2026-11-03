from collections import Counter

import numpy as np

from ..net import NetError
from ..resolve import store_dz_track
from ..util import norm_artist, now
from . import facets as F
from . import genres as G
from .catalog import Catalog, _in, art_payload, art_ref
from .discover import Context, _fans_array, _rank, _z, payload
from .home import build_reasons
from .media import cached_palettes

CUT = 1.5
SOUNDS = {
    "riffs": {
        "label": "Riffs & solos",
        "family_label": "Guitar",
        "blurb": "Songs built on huge guitar riffs, solos and shredding, found by listening to every song.",
        "concepts": ["guitar_riff", "guitar_solo", "guitar_shred"],
        "reason": "Big guitar riffs or solos",
        "shelves": [
            ("solos", "Solos that take over", ["guitar_solo", "guitar_shred"]),
            ("heavy", "Heavy riffs", ["guitar_riff", "guitar_fuzz"]),
            ("twinkly", "Twinkly & mathy", ["guitar_twinkly"]),
        ],
    },
}


def _cover(md5_value, size=160):
    return {"kind": "cover", "ref": md5_value, "src": f"/api/art/cover/{md5_value}?s={size}", "palette": None}


def _md5(ctx, corpus):
    return {r["id"]: r["md5"] for r in _in(ctx.db, "select id, md5 from dz_tracks where md5 is not null and id in ({marks})",
                                           [int(i) for i in corpus.ids])}


def _covers(corpus, rows, md5, count=4):
    out = []
    for r in rows:
        value = md5.get(int(corpus.ids[r]))
        if value and value not in out:
            out.append(value)
        if len(out) >= count:
            break
    return [_cover(v) for v in out]


def _library(corpus):
    known = corpus.known_ids()
    return np.fromiter((int(i) in known for i in corpus.ids), dtype=bool, count=len(corpus.ids))


def sound_strength(dc, concepts):
    matrix, present = dc.facets
    idx = [F.INDEX[c] for c in concepts if c in F.INDEX]
    if not idx:
        return np.zeros(len(dc.corpus.ids), dtype=np.float32)
    return np.where(present, matrix[:, idx].max(axis=1), -9.0).astype(np.float32)


def genre_cards(corpus, dc, gi, md5):
    fit = dc.taste_sims()
    lib = _library(corpus)
    keep = dc.keep()
    cards = []
    for name in gi.names:
        j = gi.col[name]
        member = gi.score[:, j] >= G.MEMBER
        songs = int(member.sum())
        if songs < 6:
            continue
        new = member & keep
        rows = np.flatnonzero(member)
        order = rows[np.argsort(-(gi.rank[rows, j] + fit[rows]))]
        cards.append({
            "id": G.slug(name), "label": G.pretty(name), "family": G.family_of(name), "songs": songs, "count": songs,
            "artists": len(set(corpus.artist_ids[member].tolist()) - {0}), "library": int((member & lib).sum()),
            "new": int(new.sum()), "fit": round(float(np.sort(fit[new])[-10:].mean()) if new.any() else 0.0, 4),
            "pool": [md5[int(corpus.ids[r])] for r in order[:60] if md5.get(int(corpus.ids[r]))],
        })
    if cards:
        affinity = 0.55 * _z(np.log1p([c["library"] for c in cards])) + 0.45 * _z([c["fit"] for c in cards])
        for card, value in zip(cards, affinity):
            card["affinity"] = round(float(value), 4)
        cards.sort(key=lambda c: -c["affinity"])
    used = set()
    for card in cards:
        pool = list(dict.fromkeys(card.pop("pool")))
        fresh = [m for m in pool if m not in used][:4]
        chosen = fresh + [m for m in pool if m not in fresh][: 4 - len(fresh)]
        used.update(chosen)
        card["arts"] = [_cover(m) for m in chosen]
    return cards


def sound_cards(corpus, dc, md5):
    fit = dc.taste_sims()
    keep = dc.keep()
    out = []
    for key, spec in SOUNDS.items():
        strength = sound_strength(dc, spec["concepts"])
        member = strength >= CUT
        if member.sum() < 6:
            continue
        rows = np.flatnonzero(member)
        order = rows[np.argsort(-(_z(strength)[rows] + _z(fit)[rows]))]
        out.append({"id": key, "label": spec["label"], "blurb": spec["blurb"], "songs": int(member.sum()),
                    "new": int((member & keep).sum()), "arts": _covers(corpus, order, md5)})
    return out


def legacy_genres(corpus, dc, md5):
    matrix, present = dc.facets
    taste = dc.taste_sims()
    genres = []
    for cid in F.IDS:
        if F.GROUP_OF[cid] != "genre":
            continue
        col = matrix[:, F.INDEX[cid]]
        mask = present & (col > 1.5)
        count = int(mask.sum())
        if count < 3:
            continue
        rows = np.where(mask)[0]
        rows = rows[np.argsort(-col[rows])][:12]
        genres.append({"id": cid, "label": F.LABELS[cid], "count": count, "songs": count,
                       "affinity": round(float(taste[mask].mean()), 4), "arts": _covers(corpus, rows, md5)})
    genres.sort(key=lambda g: -g["affinity"])
    return genres


def overview(ctx, corpus):
    dc = Context(ctx, corpus)
    taste = dc.taste_sims()
    md5 = _md5(ctx, corpus)
    gi = G.index(ctx, corpus)
    cards = genre_cards(corpus, dc, gi, md5) if gi.names and len(gi.ids) == len(corpus.ids) else []
    families = []
    for fid, label in G.FAMILY_LABELS.items():
        members = [c for c in cards if c["family"] == fid]
        if members:
            families.append({"id": fid, "label": label, "genres": members})
    families.sort(key=lambda f: -max(c["affinity"] for c in f["genres"]))
    years = dc.years
    decades = []
    for d in range(1950, (now().year // 10) * 10 + 1, 10):
        mask = (years >= d) & (years < d + 10)
        if mask.sum() < 3:
            continue
        rows = np.where(mask)[0]
        rows = rows[np.argsort(-taste[rows])][:4]
        decades.append({"id": str(d), "label": f"{d}s", "count": int(mask.sum()), "arts": _covers(corpus, rows, md5)})
    return {"genres": cards or legacy_genres(corpus, dc, md5), "families": families,
            "sounds": sound_cards(corpus, dc, md5), "coverage": round(gi.coverage, 3), "decades": decades,
            "underrated": underrated(ctx, dc)}


def _artists(db, corpus, rows, fit, lib, limit=18):
    by = {}
    for r in rows:
        a = int(corpus.artist_ids[r])
        if a:
            entry = by.setdefault(a, [0, 0, 0.0])
            entry[0] += 1
            entry[1] += int(lib[r])
            entry[2] = max(entry[2], float(fit[r]))
    ranked = sorted(by, key=lambda a: -(by[a][2] + 0.08 * np.log1p(by[a][0]) + (0.25 if by[a][1] else 0.0)))[:limit]
    known = {a["dz_id"]: a for a in Catalog(db).artists(ranked)}
    names = {r["artist_id"]: (r["artist"], r["md5"]) for r in _in(
        db, "select artist_id, min(artist) artist, max(md5) md5 from dz_tracks where artist_id in ({marks}) "
            "group by artist_id", ranked)}
    palettes = cached_palettes(db, [f"cover:{m}" for _, m in names.values() if m])
    out = []
    for a in ranked:
        name, cover = names.get(a, (None, None))
        base = known.get(a) or {"dz_id": a, "name": name, "key": norm_artist(name), "fans": None, "tier": None,
                                "art": art_payload(art_ref(cover), palettes)}
        out.append({**base, "songs": by[a][0], "known": by[a][1] > 0})
    return [a for a in out if a.get("name")]


def _decades(years, member):
    counts = Counter(int(y) // 10 * 10 for y in years[member] if y > 0)
    return [{"decade": d, "count": c} for d, c in sorted(counts.items()) if d >= 1940]


def _page(ctx, corpus, dc, member, strength, head, reason_of, shelves=()):
    fit = dc.taste_sims()
    keep = dc.keep()
    lib = _library(corpus)
    fans = _fans_array(dc)
    md5 = _md5(ctx, corpus)
    obscurity = np.where(fans >= 0, 1 - np.clip(np.log10(fans + 10) / 5, 0, 1), 0.5)
    taken = set()

    def tracks(picks):
        ids = [p for p, _ in picks]
        taken.update(ids)
        return payload(dc, picks, {i: [reason_of(corpus.index[i])] for i in ids})["items"]

    for_you = tracks(_rank(dc, _z(fit) + 0.6 * _z(strength) + 0.25 * _z(obscurity), member & keep, 30))
    built = []
    for sid, title, mask, score in shelves:
        open_rows = mask & keep & ~np.isin(corpus.ids, list(taken))
        picks = _rank(dc, score, open_rows, 12)
        if len(picks) >= 4:
            built.append({"id": sid, "title": title, "tracks": tracks(picks)})
    lib_rows = np.flatnonzero(member & lib)
    per_artist = Counter()
    picked = []
    for r in lib_rows[np.argsort(-(strength[lib_rows] + 0.5 * fit[lib_rows]))]:
        a = int(corpus.artist_ids[r])
        if per_artist[a] < 2:
            per_artist[a] += 1
            picked.append(r)
        if len(picked) >= 10:
            break
    library = Catalog(ctx.db).tracks([f"dz:{int(corpus.ids[r])}" for r in picked])
    rows = np.flatnonzero(member)
    order = rows[np.argsort(-(_z(strength)[rows] + _z(fit)[rows]))]
    lib_total = max(int(lib.sum()), 1)
    return {
        **head,
        "stats": {"songs": int(member.sum()), "artists": len(set(corpus.artist_ids[member].tolist()) - {0}),
                  "library": int((member & lib).sum()), "new": int((member & keep).sum()),
                  "share": round(float((member & lib).sum()) / lib_total, 4)},
        "arts": _covers(corpus, order, md5),
        "for_you": for_you,
        "shelves": built,
        "library": library,
        "artists": _artists(ctx.db, corpus, rows, fit, lib),
        "decades": _decades(dc.years, member),
    }


def _related(gi, member, name=None, limit=10):
    mine = set(gi.artist_ids[member].tolist()) - {0}
    if not mine:
        return []
    out = []
    for other in gi.names:
        if other == name:
            continue
        theirs = set(gi.artist_ids[gi.members(other)].tolist()) - {0}
        shared = len(mine & theirs)
        if shared >= 2:
            out.append((shared / np.sqrt(len(mine) * len(theirs)), other))
    out.sort(reverse=True)
    return [{"id": G.slug(g), "label": G.pretty(g), "overlap": round(float(s), 3)} for s, g in out[:limit]]


def genre_page(ctx, corpus, key):
    if key in SOUNDS:
        return sound_page(ctx, corpus, key)
    dc = Context(ctx, corpus)
    gi = G.index(ctx, corpus)
    name = gi.slugs.get(key)
    if name is None or len(gi.ids) != len(corpus.ids):
        return None
    j = gi.col[name]
    member = gi.score[:, j] >= G.MEMBER
    rank = gi.rank[:, j]
    fans = _fans_array(dc)
    tag = {"kind": "tag", "text": f"Tagged {name} on MusicBrainz", "strength": 0.7}
    guess = {"kind": "sound", "text": f"Sounds like {name} · estimated", "strength": 0.4}
    deep = member & (fans >= 0) & (fans < 3000)
    page = _page(ctx, corpus, dc, member, rank,
                 {"id": key, "kind": "genre", "label": G.pretty(name), "family": G.family_of(name),
                  "family_label": G.FAMILY_LABELS[G.family_of(name)], "blurb": None},
                 lambda row: tag if gi.tagged[row] else guess,
                 [("deep", "Deep cuts", deep, _z(rank) + 0.6 * _z(dc.taste_sims()))])
    page["related"] = _related(gi, member, name)
    tagged = int((member & gi.tagged).sum())
    page["source"] = {"tagged": round(tagged / max(int(member.sum()), 1), 3)}
    return page


def sound_page(ctx, corpus, key):
    spec = SOUNDS[key]
    dc = Context(ctx, corpus)
    strength = sound_strength(dc, spec["concepts"])
    member = strength >= CUT
    fit = _z(dc.taste_sims())
    shelves = []
    for sid, title, concepts in spec["shelves"]:
        s = sound_strength(dc, concepts)
        shelves.append((sid, title, s >= CUT, _z(s) + 0.7 * fit))
    reason = {"kind": "facet", "text": f"{spec['reason']} · from the audio", "strength": 0.6}
    page = _page(ctx, corpus, dc, member, strength,
                 {"id": key, "kind": "sound", "label": spec["label"], "family": "sound",
                  "family_label": spec["family_label"], "blurb": spec["blurb"]},
                 lambda row: reason, shelves)
    gi = G.index(ctx, corpus)
    lifts = []
    if gi.names and member.any() and len(gi.ids) == len(member):
        total = max(len(corpus.ids), 1)
        for name in gi.names:
            hit = gi.members(name)
            inside = int((hit & member).sum())
            if inside >= 3:
                lifts.append(((inside / member.sum()) / max(hit.sum() / total, 1e-6), inside, name))
    lifts.sort(reverse=True)
    page["related"] = [{"id": G.slug(n), "label": G.pretty(n), "overlap": round(float(l), 2)} for l, _, n in lifts[:10]]
    page["source"] = None
    return page


def underrated(ctx, dc, limit=12):
    corpus = dc.corpus
    keep = dc.keep()
    fans = _fans_array(dc)
    taste = dc.taste_sims()
    rows = _in(ctx.db, "select id, album_id, album, artist, md5, original_year, release_date from dz_tracks "
                       "where id in ({marks}) and album_id is not null", [int(i) for i in corpus.ids[keep]])
    by_album = {}
    for r in rows:
        n = corpus.index.get(r["id"])
        if n is None or (fans[n] >= 0 and fans[n] > 5000):
            continue
        entry = by_album.setdefault(r["album_id"], {"album": r["album"], "artist": r["artist"], "md5": r["md5"],
                                                    "scores": [], "year": r["original_year"] or (r["release_date"] or "")[:4]})
        entry["scores"].append(float(taste[n]))
    ranked = sorted(by_album.items(), key=lambda kv: -(np.mean(kv[1]["scores"]) + 0.01 * len(kv[1]["scores"])))[:limit]
    palettes = cached_palettes(ctx.db, [f"cover:{v['md5']}" for _, v in ranked if v["md5"]])
    return [{"dz_id": k, "title": v["album"], "artist": v["artist"], "year": v["year"],
             "art": art_payload(("cover", v["md5"]), palettes) if v["md5"] else None} for k, v in ranked]


def trending(ctx, corpus, limit=30):
    try:
        chart = ctx.dz.chart(limit=100)
    except NetError:
        chart = []
    for t in chart:
        store_dz_track(ctx.db, t)
    known = corpus.known_ids()
    ids = [t["id"] for t in chart if t.get("id") and t["id"] not in known]
    taste = corpus.taste()
    scored = []
    for i in ids:
        vec = corpus.vec(i)
        s = corpus.fit_vec(vec)
        if s is None:
            s = float((taste["modes"] @ vec).max()) if taste is not None and vec is not None else 0.0
        scored.append((i, s))
    scored.sort(key=lambda x: -x[1])
    picked = [i for i, _ in scored[:limit]]
    extra = {f"dz:{i}": {"reasons": [{"kind": "popularity", "text": "Trending on Deezer", "strength": 0.4}]} for i in picked}
    return Catalog(ctx.db).tracks([f"dz:{i}" for i in picked], extra)


def query(ctx, corpus, filters, limit=60, offset=0):
    dc = Context(ctx, corpus)
    n = len(corpus.ids)
    keep = dc.keep(require_preview=False)
    score = _z(dc.taste_sims())
    matrix, present = dc.facets
    genre = filters.get("genre")
    handled = False
    if genre in SOUNDS:
        strength = sound_strength(dc, SOUNDS[genre]["concepts"])
        keep &= strength >= CUT
        score = score + 0.6 * _z(strength)
        handled = True
    elif genre:
        gi = G.index(ctx, corpus)
        name = gi.slugs.get(genre)
        if name and len(gi.ids) == n:
            keep &= gi.members(name)
            score = score + 0.6 * _z(gi.rank[:, gi.col[name]])
            handled = True
    for key in ("genre", "mood", "instrument"):
        cid = filters.get(key)
        if key == "genre" and handled:
            continue
        if cid and cid in F.INDEX:
            col = matrix[:, F.INDEX[cid]]
            keep &= present & (col > 1.0)
            score = score + 0.8 * col
    decade = filters.get("decade")
    years = dc.years
    if decade:
        d = int(decade)
        keep &= (years >= d) & (years < d + 10)
    if filters.get("year_from"):
        keep &= years >= int(filters["year_from"])
    if filters.get("year_to"):
        keep &= (years > 0) & (years <= int(filters["year_to"]))
    fans = _fans_array(dc)
    pop = filters.get("popularity")
    if pop == "underground":
        keep &= (fans >= 0) & (fans < 1000)
    elif pop == "niche":
        keep &= (fans >= 0) & (fans < 10000)
    elif pop == "known":
        keep &= fans >= 10000
    energy = filters.get("energy")
    if energy:
        lo, hi = energy
        ev = np.array([F.energy_value(matrix[i]) if present[i] else 0.5 for i in range(n)])
        keep &= (ev >= lo) & (ev <= hi)
    tempo = filters.get("tempo")
    if tempo:
        rows = {r["dz_id"]: r["tempo"] for r in _in(ctx.db, "select dz_id, tempo from dsp where dz_id in ({marks})",
                                                     [int(i) for i in corpus.ids])}
        tv = np.array([rows.get(int(i)) or 0 for i in corpus.ids])
        keep &= (tv >= tempo[0]) & (tv <= tempo[1])
    sort = filters.get("sort", "taste")
    if sort == "newest":
        score = years.astype(np.float64)
    elif sort == "oldest":
        score = -np.where(years > 0, years, 9999).astype(np.float64)
    elif sort == "obscure":
        score = -np.where(fans >= 0, fans, 10 ** 6).astype(np.float64)
    total = int(keep.sum())
    order = np.argsort(-np.where(keep, score, -np.inf))
    order = [i for i in order if keep[i]][offset:offset + limit]
    ids = [int(corpus.ids[i]) for i in order]
    extra = build_reasons(ctx, corpus, dc.taste, ids)
    return {"total": total, "offset": offset, "items": Catalog(ctx.db).tracks([f"dz:{i}" for i in ids], extra)}
