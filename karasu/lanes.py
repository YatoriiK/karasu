import json
import random
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from rapidfuzz import fuzz

from .net import NetError
from .resolve import (Budget, artist_match, artist_profile, deezer_artist, mb_artist_cached, mb_artist_earliest,
                      store_dz_track, title_match)
from .sources.musicbrainz import lucene
from .util import days_since, fold, is_junk, norm_artist, now, now_iso, year_of

STYLES_PATH = Path(__file__).with_name("discogs_styles.json")
DISCOGS_GENRES = {
    "blues", "brass & military", "children's", "classical", "electronic", "folk, world, & country",
    "funk / soul", "hip hop", "jazz", "latin", "non-music", "pop", "reggae", "rock", "stage & screen",
}


@dataclass
class Cand:
    lane: str
    source: str
    dz_id: int
    title: str
    artist: str
    artist_key: str
    artist_dz: int = None
    album: str = None
    album_id: int = None
    label: str = None
    duration: int = None
    rank: int = None
    preview: str = None
    year: int = None
    year_source: str = None
    debut: int = None
    listeners: int = None
    playcount: int = None
    fans: int = None
    pace: int = None
    graph: float = None
    graph_sources: int = 0
    support: int = 0
    via: list = field(default_factory=list)
    have: int = None
    want: int = None
    tags: dict = None
    feats: dict = field(default_factory=dict)
    score: float = 0.0
    mode: int = None
    nearest: str = None
    reasons: str = ""
    vec: object = None
    sp_uri: str = None
    sp_id: str = None


def _cand(lane, source, t, artist_name=None, artist_dz=None, **extra):
    artist = t.get("artist") or {}
    album = t.get("album") or {}
    name = (artist_name or artist.get("name") or "").strip()
    return Cand(
        lane=lane, source=source, dz_id=int(t["id"]), title=(t.get("title") or "").strip(), artist=name,
        artist_key=norm_artist(name), artist_dz=artist_dz or artist.get("id"),
        album=extra.pop("album", None) or album.get("title"), album_id=extra.pop("album_id", None) or album.get("id"),
        duration=t.get("duration"), rank=t.get("rank"), preview=t.get("preview"), **extra,
    )


def lfm_artist(ctx, name):
    key = norm_artist(name)
    row = ctx.db.one("select * from lfm_artists where norm=?", (key,))
    if row and (days_since(row["checked_at"]) or 99) < 30:
        return row["listeners"], row["playcount"], json.loads(row["tags"] or "{}")
    if not ctx.lfm.enabled:
        return None, None, {}
    try:
        info = ctx.lfm.info(name) or {}
        tags = dict(ctx.lfm.top_tags(name, limit=20))
    except NetError:
        return None, None, {}
    listeners, playcount = info.get("listeners"), info.get("playcount")
    ctx.db.x(
        "insert or replace into lfm_artists(norm, name, listeners, playcount, tags, checked_at) values(?,?,?,?,?,?)",
        (key, info.get("name") or name, listeners, playcount, json.dumps(tags), now_iso()),
    )
    return listeners, playcount, tags


def _usable(t, fcfg):
    if not t.get("id") or not t.get("preview"):
        return False
    duration = t.get("duration") or 0
    if duration and not (fcfg["min_duration_s"] <= duration <= fcfg["max_duration_s"]):
        return False
    return not is_junk(t.get("title"), (t.get("album") or {}).get("title"))


def classify(cfg, earliest, latest, lanes=("fresh", "lost")):
    this_year = now().year
    if earliest is None:
        return None
    if "fresh" in lanes and earliest >= this_year - int(cfg["fresh"]["debut_max_years"]):
        latest_age = days_since(latest)
        if latest_age is not None and latest_age <= float(cfg["fresh"]["recent_release_months"]) * 30.4:
            return "fresh"
        return None
    if "lost" in lanes and earliest <= this_year - int(cfg["lost"]["older_than_years"]):
        return "lost"
    return None


def _old_on_musicbrainz(ctx, dz_id, name, prof, budget):
    cutoff = now().year - int(ctx.cfg["lost"]["older_than_years"])
    fans = prof.get("fans")
    if fans is not None and fans > ctx.cfg["lost"]["fans_cap"]:
        return None
    cached, year = mb_artist_cached(ctx, dz_id)
    if not cached:
        if budget is None or not budget.take():
            return None
        try:
            titles = [a.get("title") for a in ctx.dz.artist_albums(dz_id, limit=100)]
            year = mb_artist_earliest(ctx, dz_id, prof.get("name") or name, titles)
        except NetError:
            return None
    return year if year is not None and year <= cutoff else None


def _artist_check(ctx, g, key, name, dz_id, known, lanes, source=None, mb_budget=None):
    fcfg = ctx.cfg["filters"]
    if not dz_id:
        try:
            found = deezer_artist(ctx, name)
        except NetError:
            return []
        if not found:
            return []
        dz_id = found["id"]
    if dz_id in known.get("artist_dz", set()):
        return []
    try:
        prof = artist_profile(ctx, dz_id, name)
    except NetError:
        return []
    earliest = year_of(prof.get("earliest"))
    lane = classify(ctx.cfg, earliest, prof.get("latest"), lanes)
    if lane is None and "lost" in lanes and earliest is not None:
        old = _old_on_musicbrainz(ctx, dz_id, name, prof, mb_budget)
        if old:
            lane, earliest = "lost", old
    if lane is None:
        return []
    lcfg = ctx.cfg[lane]
    fans = prof.get("fans")
    if fans is not None and fans > lcfg["fans_cap"]:
        return []
    listeners, playcount, tags = lfm_artist(ctx, prof.get("name") or name)
    if listeners is not None and fans is not None and listeners > 200 * (fans + 10):
        listeners, playcount, tags = None, None, {}
    if listeners is not None and listeners > lcfg["listeners_cap"]:
        return []
    try:
        top = ctx.dz.artist_top(dz_id, limit=12)
    except NetError:
        return []
    per_artist = int(lcfg.get("tracks_per_artist", 2))
    picks = []
    for t in top:
        if len(picks) >= per_artist:
            break
        if not _usable(t, fcfg):
            continue
        if not artist_match((t.get("artist") or {}).get("name"), prof.get("name") or name):
            continue
        store_dz_track(ctx.db, t)
        picks.append(t)
    out = []
    source_key = key or norm_artist(name)
    for t in picks:
        out.append(_cand(
            lane, source or ("graph" if g is not None and source_key in g.names else "deep_tags"), t,
            artist_name=prof.get("name") or name, artist_dz=dz_id,
            debut=earliest, listeners=listeners, playcount=playcount, fans=fans, pace=prof.get("pace_6m"),
            graph=g.rank.get(source_key) if g is not None else None,
            graph_sources=len(g.sources.get(source_key, ())) if g is not None else 0,
            support=len(g.support.get(source_key, ())) if g is not None else 0,
            via=g.via(source_key) if g is not None and source_key in g.names else [],
            tags=tags,
        ))
    return out


def _known_artist(key, dz_id, known):
    return key in known["artist_norms"] or key in known["blocked_artists"] or key in known.get("rec_artists", set())


def graph_lane(ctx, g, known, limit, lanes=("fresh", "lost"), log=print):
    order = sorted(
        (k for k in g.names if k not in g.seeds and not _known_artist(k, g.dz.get(k), known)),
        key=lambda k: -g.rank.get(k, 0),
    )
    ranked = order[:limit]
    if "fresh" in lanes:
        cap = int(ctx.cfg["fresh"]["fans_cap"])
        small = [k for k in order[limit:] if g.fans.get(k) is not None and g.fans[k] <= cap]
        ranked += small[:int(ctx.cfg["fresh"]["small_artists_to_check"])]
    log(f"  graph lane: checking {len(ranked)} artists")
    budget = Budget(ctx.cfg["lost"]["mb_artist_checks"])
    out = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for cands in pool.map(lambda k: _artist_check(ctx, g, k, g.names[k], g.dz.get(k), known, lanes,
                                                      mb_budget=budget), ranked):
            out.extend(cands)
    return out


def deep_tag_lane(ctx, taste, known, g=None, lanes=("fresh", "lost"), log=print):
    if not ctx.lfm.enabled or not taste.tags:
        return []
    lcfg = ctx.cfg["lost"]
    lo, hi = lcfg["deep_tag_pages"]
    tags = sorted(taste.tags.items(), key=lambda kv: -kv[1])[:int(lcfg["deep_tags_max"])]
    names = []
    for tag, _ in tags:
        page = random.randint(int(lo), int(hi))
        try:
            names += ctx.lfm.tag_top_artists(tag, page=page, limit=50)
        except NetError:
            continue
    seen = set()
    todo = []
    for name in names:
        key = norm_artist(name)
        if not key or key in seen or _known_artist(key, None, known) or (g is not None and key in g.names):
            continue
        seen.add(key)
        todo.append(name)
    random.shuffle(todo)
    todo = todo[:120]
    log(f"  deep-tag lane: checking {len(todo)} long-tail artists")
    out = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for cands in pool.map(lambda n: _artist_check(ctx, None, None, n, None, known, lanes), todo):
            out.extend(cands)
    return out


def new_release_lane(ctx, taste, known, g=None, lanes=("fresh", "lost"), log=print):
    source_tags = taste.mb_tags or taste.tags
    if "fresh" not in lanes or not source_tags:
        return []
    year = now().year
    tags = sorted(source_tags.items(), key=lambda kv: -kv[1])[:6]
    names = []
    for tag, _ in tags:
        query = (f'tag:"{lucene(tag)}" AND firstreleasedate:[{year - 1}-01-01 TO {year}-12-31] '
                 f'AND (primarytype:album OR primarytype:ep)')
        try:
            groups = ctx.mb.search_release_groups(query, limit=100)
        except NetError:
            continue
        for rg in groups:
            for credit in rg.get("artist-credit") or []:
                if isinstance(credit, dict):
                    names.append(credit.get("name") or (credit.get("artist") or {}).get("name"))
    seen, todo = set(), []
    for name in names:
        key = norm_artist(name)
        if not key or key in seen or key in ("various artists",) or _known_artist(key, None, known):
            continue
        seen.add(key)
        todo.append(name)
    random.shuffle(todo)
    todo = todo[:100]
    log(f"  new-release lane: checking {len(todo)} artists with recent releases in your tags")
    out = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for cands in pool.map(lambda n: _artist_check(ctx, g, norm_artist(n), n, None, known, ("fresh",),
                                                      source="new_releases"), todo):
            out.extend(cands)
    return out


def _label_norm(name):
    text = fold(name or "")
    for word in ("records", "recordings", "record", "music", "ltd", "inc", "llc", "the", "group", "label"):
        text = text.replace(word, " ")
    return " ".join(text.replace("-", " ").split())


def label_matches(actual, wanted):
    a, w = _label_norm(actual), _label_norm(wanted)
    return bool(a and w) and (a == w or fuzz.ratio(a, w) >= 92)


def label_lane(ctx, known, log=print):
    lcfg = ctx.cfg["lost"]
    labels = list(lcfg["labels"])
    if not labels:
        return []
    cursor = int(ctx.db.meta("label_cursor", 0))
    take = [labels[(cursor + i) % len(labels)] for i in range(min(len(labels), int(lcfg["labels_per_run"])))]
    ctx.db.set_meta("label_cursor", (cursor + len(take)) % len(labels))
    per_label = int(lcfg["label_albums_per_label"])
    fcfg = ctx.cfg["filters"]
    jobs = []
    for label in take:
        offset = int(ctx.db.meta(f"label_offset:{label}", 0))
        try:
            albums = ctx.dz.search_label_albums(label, limit=per_label, index=offset)
        except NetError:
            continue
        next_offset = offset + per_label if len(albums) >= per_label else 0
        ctx.db.set_meta(f"label_offset:{label}", next_offset)
        jobs += [(label, a) for a in albums if a.get("id")]
    log(f"  lost: scanning {len(jobs)} albums from {len(take)} reissue labels")

    def album_cands(job):
        label, stub = job
        try:
            album = ctx.dz.album(stub["id"])
        except NetError:
            return []
        if not album or not label_matches(album.get("label"), label):
            return []
        if (album.get("fans") or 0) > lcfg["fans_cap"]:
            return []
        various = norm_artist((album.get("artist") or {}).get("name")) in ("various artists", "various", "")
        tracks = [t for t in ((album.get("tracks") or {}).get("data") or []) if _usable(t, fcfg)]
        tracks = [t for t in tracks if not _known_artist(norm_artist((t.get("artist") or {}).get("name")), None, known)]
        if not tracks:
            return []
        tracks.sort(key=lambda t: -(t.get("rank") or 0))
        picks = tracks[:1] + random.sample(tracks[1:], min(len(tracks) - 1, int(lcfg["tracks_per_album"]) - 1))
        out = []
        for t in picks:
            t = {**t, "album": {"id": album["id"], "title": album.get("title"), "release_date": album.get("release_date")}}
            store_dz_track(ctx.db, t)
            out.append(_cand(
                "lost", "labels", t, label=album.get("label"), album=album.get("title"), album_id=album["id"],
                fans=None if various else album.get("fans"),
                year=year_of(album.get("release_date")), year_source="deezer-album",
            ))
        return out

    out = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for cands in pool.map(album_cands, jobs):
            out.extend(cands)
    return out


def _styles():
    if not STYLES_PATH.exists():
        return []
    with open(STYLES_PATH, encoding="utf-8-sig") as fh:
        return [tuple(p) for p in json.load(fh)]


def map_styles(tags, limit):
    styles = _styles()
    picked = []
    for tag, weight in sorted(tags.items(), key=lambda kv: -kv[1]):
        t = fold(tag).replace("-", " ")
        best = None
        for genre, style in styles:
            s = fold(style).replace("-", " ")
            score = 100 if s == t else fuzz.ratio(s, t)
            if score >= 90 and (best is None or score > best[0]):
                best = (score, ("style", style))
        if best is None and fold(tag) in DISCOGS_GENRES:
            best = (100, ("genre", tag.title()))
        if best and best[1] not in [p[0] for p in picked]:
            picked.append((best[1], weight))
        if len(picked) >= limit:
            break
    return picked


def _discogs_title(raw):
    artist, _, title = (raw or "").partition(" - ")
    artist = artist.replace("*", "").strip()
    while artist.endswith(")") and "(" in artist and artist[artist.rfind("(") + 1:-1].isdigit():
        artist = artist[:artist.rfind("(")].strip()
    return artist, title.strip()


def discogs_lane(ctx, taste, known, log=print):
    if not ctx.dg.enabled or not taste.tags:
        return []
    lcfg = ctx.cfg["lost"]
    cutoff = now().year - int(lcfg["older_than_years"])
    picked = map_styles(taste.tags, int(lcfg["discogs_styles_max"]))
    if not picked:
        log("  lost: no Discogs styles matched your tags")
        return []
    log("  lost: Discogs styles " + ", ".join(v for (_, v), _ in picked))
    start = int(lcfg["discogs_from_year"]) // 10 * 10
    found = {}
    for (kind, value), _ in picked:
        for decade in range(start, cutoff + 1, 10):
            years = [y for y in range(decade, min(decade + 10, cutoff + 1))]
            for year in random.sample(years, min(len(years), int(lcfg["discogs_years_per_decade"]))):
                try:
                    results = ctx.dg.search(type="master", year=year, per_page=100, **{kind: value})
                except NetError:
                    continue
                for r in results:
                    community = r.get("community") or {}
                    have, want = community.get("have"), community.get("want")
                    if have is None or not (lcfg["discogs_have_min"] <= have <= lcfg["discogs_have_cap"]):
                        continue
                    gem = (want or 0) / (have + 10)
                    key = r.get("master_id") or r.get("id")
                    if key not in found or found[key]["gem"] < gem:
                        found[key] = {"raw": r, "gem": gem, "have": have, "want": want, "year": year_of(r.get("year")) or year}
    best = sorted(found.values(), key=lambda f: -f["gem"])[:80]
    log(f"  lost: {len(found)} Discogs gems, resolving top {len(best)} on Deezer")
    fcfg = ctx.cfg["filters"]

    def resolve(item):
        artist, title = _discogs_title(item["raw"].get("title"))
        if not artist or not title or _known_artist(norm_artist(artist), None, known):
            return []
        try:
            albums = ctx.dz.search_album(artist, title, limit=5)
        except NetError:
            return []
        for stub in albums:
            if not artist_match((stub.get("artist") or {}).get("name"), artist) or not title_match(stub.get("title"), title, 85):
                continue
            try:
                album = ctx.dz.album(stub["id"])
            except NetError:
                return []
            tracks = [t for t in ((album or {}).get("tracks") or {}).get("data") or [] if _usable(t, fcfg)]
            if not tracks:
                return []
            tracks.sort(key=lambda t: -(t.get("rank") or 0))
            out = []
            for t in tracks[:2]:
                t = {**t, "album": {"id": album["id"], "title": album.get("title"), "release_date": album.get("release_date")}}
                store_dz_track(ctx.db, t)
                out.append(_cand(
                    "lost", "discogs", t, label=album.get("label"), album=album.get("title"), album_id=album["id"],
                    have=item["have"], want=item["want"], year=item["year"], year_source="discogs",
                ))
            return out
        return []

    out = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for cands in pool.map(resolve, best):
            out.extend(cands)
    return out
