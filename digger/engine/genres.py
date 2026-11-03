import json
import re
import threading
from collections import Counter

import numpy as np

from .. import DATA
from ..net import NetError
from ..util import chunks, norm_artist, now, now_iso, parse_iso, year_of

FAMILIES = [
    ("hiphop", "Hip hop & rap", ["hip hop", "hip-hop", "rap", "trap", "drill", "plugg", "boom bap", "grime", "phonk",
                                 "horrorcore", "crunk", "bounce", "turntablism"]),
    ("metal", "Metal", ["metal", "doom", "sludge", "grindcore", "djent", "deathcore"]),
    ("punk", "Punk & emo", ["punk", "hardcore", "emo", "screamo", "riot grrrl", "crust"]),
    ("electronic", "Electronic", ["electronic", "techno", "house", "ambient", "idm", "drum and bass", "jungle", "dubstep",
                                  "uk garage", "breakbeat", "breaks", "electro", "synth", "trance", "downtempo",
                                  "trip hop", "vaporwave", "chillwave", "glitch", "edm", "bass music", "footwork",
                                  "hyperpop", "witch house", "wave", "dance", "chiptune", "gabber", "eurobeat"]),
    ("jazz", "Jazz", ["jazz", "bebop", "swing", "big band"]),
    ("soul", "R&B, soul & funk", ["r&b", "rnb", "soul", "funk", "disco", "motown", "new jack swing", "gospel",
                                  "quiet storm", "boogie"]),
    ("folk", "Folk, country & blues", ["folk", "country", "americana", "bluegrass", "singer-songwriter",
                                       "singer/songwriter", "blues", "appalachian"]),
    ("pop", "Pop", ["pop", "idol", "schlager", "ballad"]),
    ("rock", "Rock & indie", ["rock", "indie", "shoegaze", "slowcore", "sadcore", "post-punk", "grunge", "britpop",
                              "psychedeli", "math", "lo-fi", "jangle", "space", "surf", "garage", "neo-psychedelia"]),
    ("experimental", "Experimental", ["experimental", "avant-garde", "noise", "drone", "musique concrète",
                                      "sound collage", "plunderphonics", "field recording", "free improvisation"]),
    ("global", "Latin & global", ["latin", "reggae", "dub", "ska", "afro", "cumbia", "salsa", "samba", "mpb",
                                  "reggaeton", "dancehall", "highlife", "bachata", "baile", "tropical", "bolero",
                                  "flamenco", "fado", "tango", "chanson", "k-", "j-", "c-", "bossa"]),
    ("classical", "Classical & score", ["classical", "orchestral", "opera", "baroque", "romanticism", "minimalism",
                                        "soundtrack", "score", "video game music", "anime", "chamber music", "choral"]),
]
OVERRIDES = {
    "dream pop": "rock", "noise pop": "rock", "indie pop": "pop", "art pop": "pop", "chamber pop": "pop",
    "dance-pop": "pop", "electropop": "pop", "synth-pop": "electronic", "new wave": "rock", "darkwave": "rock",
    "coldwave": "rock", "post-punk revival": "rock", "bossa nova": "global", "city pop": "pop", "j-pop": "pop",
    "k-pop": "pop", "lo-fi hip hop": "hiphop", "emo rap": "hiphop", "pop rap": "hiphop", "rap rock": "hiphop",
    "jazz rap": "hiphop", "trip hop": "electronic", "pop punk": "punk", "dance-punk": "punk", "post-hardcore": "punk",
    "neo soul": "soul", "alternative r&b": "soul", "contemporary r&b": "soul", "space rock": "rock",
    "noise rock": "rock", "drone": "experimental", "ambient": "electronic", "dark ambient": "electronic",
    "singer-songwriter": "folk", "anime": "classical", "video game music": "classical", "uk garage": "electronic",
}
FAMILY_LABELS = {f: label for f, label, _ in FAMILIES} | {"other": "Other"}
RECHECK_FOUND = 180 * 86400
RECHECK_MISSING = 45 * 86400
_GENRE_NAMES = {}


def family_of(name):
    name = (name or "").lower()
    if name in OVERRIDES:
        return OVERRIDES[name]
    for fid, _, keys in FAMILIES:
        if any(k in name for k in keys):
            return fid
    return "other"


def genre_names(ctx):
    if _GENRE_NAMES.get("names"):
        return _GENRE_NAMES["names"]
    names, offset = set(), 0
    while True:
        try:
            data = ctx.mb.genres(offset)
        except NetError:
            break
        page = [g["name"].strip().lower() for g in data.get("genres") or [] if g.get("name")]
        names.update(page)
        offset += 100
        if not page or offset >= int(data.get("genre-count") or 0):
            break
    if names:
        _GENRE_NAMES["names"] = names
    return names


def _due(db):
    stamp = now()
    seen = {}
    for r in db.q("select artist_id, genres, checked_at from artist_genres"):
        when = parse_iso(r["checked_at"])
        wait = RECHECK_FOUND if r["genres"] not in (None, "{}") else RECHECK_MISSING
        seen[r["artist_id"]] = when is not None and (stamp - when).total_seconds() < wait
    rows = db.q(
        "select t.artist_id id, min(t.artist) name, count(e.dz_id) n, max(m.dz_id is not null) lib from dz_tracks t "
        "left join embeddings e on e.dz_id = t.id left join sp_dz m on m.dz_id = t.id "
        "where t.artist_id is not null and t.artist is not null group by t.artist_id order by lib desc, n desc")
    return [{"id": r["id"], "name": r["name"], "norm": norm_artist(r["name"])} for r in rows
            if r["n"] and not seen.get(r["id"])]


def _spotify_ids(db):
    pairs = Counter()
    for r in db.q("select t.artist_id, json_extract(s.artist_ids, '$[0]') sp from sp_dz m "
                  "join dz_tracks t on t.id = m.dz_id join sp_tracks s on s.id = m.sp_id "
                  "where m.dz_id > 0 and t.artist_id is not null"):
        if r["sp"]:
            pairs[(r["artist_id"], r["sp"])] += 1
    best = {}
    for (artist, sp), n in pairs.most_common():
        best.setdefault(artist, sp)
    return best


def _linked(ctx, batch, spotify):
    urls = {}
    for row in batch:
        urls[f"https://www.deezer.com/artist/{row['id']}"] = row["id"]
        if spotify.get(row["id"]):
            urls[f"https://open.spotify.com/artist/{spotify[row['id']]}"] = row["id"]
    try:
        found = ctx.mb.url_artists(list(urls))
    except NetError:
        return {}
    out = {}
    for u in found:
        artist = urls.get(u.get("resource"))
        mbids = {r["artist"]["id"] for r in u.get("relations") or [] if r.get("artist")}
        if artist and len(mbids) == 1:
            out.setdefault(artist, mbids.pop())
    return out


def _clean(items, allowed=None):
    out = {}
    for item in items or []:
        name = (item.get("name") or "").strip().lower()
        if name and (item.get("count") or 0) > 0 and (allowed is None or name in allowed):
            out[name] = int(item["count"])
    return out


def _lookup(ctx, mbid, allowed):
    data = ctx.mb.artist(mbid)
    genres = _clean(data.get("genres"))
    if not genres:
        genres = _clean(data.get("tags"), allowed)
    return genres, (data.get("area") or {}).get("name"), (data.get("begin-area") or {}).get("name")


def _search(ctx, row, allowed):
    found = ctx.mb.search_artist(row["name"], limit=5)
    exact = [a for a in found if norm_artist(a.get("name")) == row["norm"] and int(a.get("score") or 0) >= 95]
    if len(exact) != 1:
        return None, {}, None
    match = exact[0]
    return match.get("id"), _clean(match.get("tags"), allowed), (match.get("area") or {}).get("name")


def learn(jc, budget=None):
    ctx = jc.ctx
    db = ctx.db
    rows = _due(db)
    if budget:
        rows = rows[:budget]
    if not rows:
        return {"artists": 0}
    jc.progress("Learning genres", 0, len(rows), force=True)
    allowed = genre_names(ctx)
    spotify = _spotify_ids(db)
    done = tagged = 0
    for batch in chunks(rows, 50):
        linked = _linked(ctx, batch, spotify)
        for row in batch:
            mbid, genres, area, origin, method = linked.get(row["id"]), {}, None, None, "none"
            try:
                if mbid:
                    genres, area, origin = _lookup(ctx, mbid, allowed)
                    method = "link"
                else:
                    mbid, genres, area = _search(ctx, row, allowed)
                    method = "search" if mbid else "none"
            except NetError:
                continue
            db.x("insert or replace into artist_genres(artist_id, mbid, genres, method, area, origin, checked_at) "
                 "values(?,?,?,?,?,?,?)", (row["id"], mbid, json.dumps(genres), method, area, origin, now_iso()))
            done += 1
            tagged += bool(genres)
            jc.progress("Learning genres", done, len(rows))
    return {"artists": done, "tagged": tagged}


PROBES = DATA / "genre_probes.npz"
ALIASES = {"rap": "hip hop", "hip-hop": "hip hop", "rnb": "r&b"}
UPPER = {"r&b": "R&B", "idm": "IDM", "edm": "EDM", "uk garage": "UK garage", "k-pop": "K-pop", "j-pop": "J-pop",
         "j-rock": "J-rock", "mpb": "MPB", "ebm": "EBM", "lo-fi": "Lo-fi"}
KEEP_SHARE = 0.25
IMPLIED = 0.6
MEMBER = 0.5
PROBE_ARTISTS = 6
PROBE_TRACKS = 30
_INDEX = {"key": None, "value": None}
_INDEX_LOCK = threading.Lock()


def pretty(name):
    if name in UPPER:
        return UPPER[name]
    return name[:1].upper() + name[1:]


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.replace("&", " and ")).strip("-")


def contains(small, big):
    if small == big or small not in big:
        return False
    return f" {small.replace('-', ' ')} " in f" {big.replace('-', ' ')} "


def artist_weights(db):
    out = {}
    for r in db.q("select artist_id, genres from artist_genres where genres is not null and genres != '{}'"):
        counts = {}
        for name, count in json.loads(r["genres"]).items():
            name = ALIASES.get(name, name)
            counts[name] = max(counts.get(name, 0), count)
        top = max(counts.values()) if counts else 0
        if top > 0:
            out[r["artist_id"]] = {g: c / top for g, c in counts.items() if c / top >= KEEP_SHARE}
    return out


def parents(names, candidates):
    out = {}
    for g in names:
        ups = [p for p in candidates if contains(p, g) and family_of(p) == family_of(g)]
        if ups:
            out[g] = ups
    return out


def expand(weights, ups):
    out = dict(weights)
    for g, w in weights.items():
        for p in ups.get(g, []):
            out[p] = max(out.get(p, 0.0), IMPLIED * w)
    return out


def _corpus_rows(corpus):
    with corpus.lock:
        return corpus.stamp, corpus.ids, corpus.matrix, corpus.artist_ids


def labelled(db, broad=()):
    raw = artist_weights(db)
    names = {g for w in raw.values() for g in w}
    ups = parents(names, set(broad) | names)
    return {a: expand(w, ups) for a, w in raw.items()}


def threshold(y, p, precision=0.6, recall=0.15):
    order = np.argsort(-p)
    hits = np.cumsum(y[order])
    prec = hits / np.arange(1, len(y) + 1)
    rec = hits / max(y.sum(), 1)
    ok = np.flatnonzero((prec >= precision) & (rec >= recall))
    return float(p[order][ok[-1]]) if len(ok) else None


def train_probes(ctx, corpus, broad=(), progress=None):
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import average_precision_score

    def fit(X, y):
        return LogisticRegression(C=0.5, max_iter=1000, class_weight="balanced").fit(X, y)

    _, ids, matrix, artist_ids = _corpus_rows(corpus)
    weights = labelled(ctx.db, broad)
    rows_by_artist = {}
    for n, a in enumerate(artist_ids.tolist()):
        if a:
            rows_by_artist.setdefault(a, []).append(n)
    tagged = [a for a in rows_by_artist if a in weights]
    support = Counter(g for a in tagged for g, w in weights[a].items() if w >= MEMBER)
    candidates = [g for g, count in support.most_common() if count >= PROBE_ARTISTS]
    kept = []
    for step, g in enumerate(candidates):
        if progress:
            progress(step, len(candidates))
        pos_art = [a for a in tagged if weights[a].get(g, 0) >= MEMBER]
        neg_art = [a for a in tagged if not any(h == g or contains(g, h) or contains(h, g) for h in weights[a])]
        if sum(len(rows_by_artist[a]) for a in pos_art) < PROBE_TRACKS or len(neg_art) < PROBE_ARTISTS:
            continue
        ys, ps = [], []
        for k in range(3):
            tr_p = [n for a in pos_art if a % 3 != k for n in rows_by_artist[a]]
            tr_n = [n for a in neg_art if a % 3 != k for n in rows_by_artist[a]]
            te_p = [n for a in pos_art if a % 3 == k for n in rows_by_artist[a]]
            te_n = [n for a in neg_art if a % 3 == k for n in rows_by_artist[a]]
            if len(tr_p) < 10 or not te_p or not te_n:
                continue
            clf = fit(matrix[tr_p + tr_n], np.r_[np.ones(len(tr_p)), np.zeros(len(tr_n))])
            ps.append(clf.predict_proba(matrix[te_p + te_n])[:, 1])
            ys.append(np.r_[np.ones(len(te_p)), np.zeros(len(te_n))])
        if not ys:
            continue
        y, p = np.concatenate(ys), np.concatenate(ps)
        ap = float(average_precision_score(y, p))
        cut = threshold(y, p)
        if cut is None or ap < max(0.3, 2.5 * y.mean()):
            continue
        pos = [n for a in pos_art for n in rows_by_artist[a]]
        neg = [n for a in neg_art for n in rows_by_artist[a]]
        clf = fit(matrix[pos + neg], np.r_[np.ones(len(pos)), np.zeros(len(neg))])
        kept.append((g, clf.coef_[0], clf.intercept_[0], cut, ap))
    tagged_total = ctx.db.one("select count(*) from artist_genres where genres is not null and genres != '{}'")[0]
    if kept:
        np.savez(PROBES, names=np.array([k[0] for k in kept]), coef=np.stack([k[1] for k in kept]).astype(np.float32),
                 intercept=np.array([k[2] for k in kept], dtype=np.float32),
                 cut=np.array([k[3] for k in kept], dtype=np.float32), ap=np.array([k[4] for k in kept], dtype=np.float32))
    ctx.db.set_meta("genre_probes", {"genres": len(kept), "tried": len(candidates), "artists": len(tagged),
                                     "tagged": tagged_total, "at": now_iso()})
    return {"genres": len(kept), "tried": len(candidates), "artists": len(tagged)}


def load_probes():
    if not PROBES.exists():
        return None
    data = np.load(PROBES)
    return [str(n) for n in data["names"]], data["coef"], data["intercept"], data["cut"]


def calibrate(p, cut):
    cut = np.clip(cut, 1e-3, 0.999)
    return np.where(p >= cut, 0.5 + 0.5 * (p - cut) / (1 - cut), 0.5 * p / cut)


def refresh(jc, corpus, retrain=False):
    out = learn(jc)
    db = jc.ctx.db
    tagged = db.one("select count(*) from artist_genres where genres is not null and genres != '{}'")[0]
    meta = db.meta("genre_probes") or {}
    if retrain or not PROBES.exists() or tagged - int(meta.get("tagged") or 0) >= 15:
        jc.progress("Learning what each genre sounds like", 0, 0, force=True)
        trained = train_probes(jc.ctx, corpus, genre_names(jc.ctx),
                               progress=lambda d, t: jc.progress("Learning what each genre sounds like", d, t))
        out["probes"] = trained["genres"]
    return out


class GenreIndex:
    def __init__(self, ctx, corpus):
        _, ids, matrix, artist_ids = _corpus_rows(corpus)
        self.ids = ids
        self.artist_ids = artist_ids
        weights = labelled(ctx.db, _GENRE_NAMES.get("names") or ())
        probes = load_probes()
        support = Counter(g for a in set(artist_ids.tolist()) for g, w in weights.get(a, {}).items() if w >= MEMBER)
        names = [g for g, c in support.items() if c >= 2]
        if probes:
            names += [g for g in probes[0] if g not in names]
        self.names = sorted(names)
        self.col = {g: j for j, g in enumerate(self.names)}
        self.slugs = {slug(g): g for g in self.names}
        n, width = len(ids), len(self.names)
        tags = np.zeros((n, width), dtype=np.float32)
        tagged = np.zeros(n, dtype=bool)
        for row, a in enumerate(artist_ids.tolist()):
            w = weights.get(a)
            if w:
                tagged[row] = True
                for g, v in w.items():
                    j = self.col.get(g)
                    if j is not None:
                        tags[row, j] = v
        audio = np.zeros((n, width), dtype=np.float32)
        if probes and n:
            pnames, coef, intercept, cut = probes
            p = calibrate(1.0 / (1.0 + np.exp(-(matrix @ coef.T + intercept))), cut)
            by_artist = {}
            for row, a in enumerate(artist_ids.tolist()):
                by_artist.setdefault(a, []).append(row)
            smooth = p.copy()
            for a, rows in by_artist.items():
                if a and len(rows) > 1:
                    smooth[rows] = 0.5 * p[rows] + 0.5 * p[rows].mean(axis=0)
            for k, g in enumerate(pnames):
                audio[:, self.col[g]] = smooth[:, k]
        self.tagged = tagged
        self.audio = audio
        self.score = np.where(tagged[:, None], tags, 0.95 * audio).astype(np.float32)
        self.rank = (self.score + 0.25 * audio).astype(np.float32)
        self.coverage = float(tagged.mean()) if n else 0.0

    def members(self, name):
        return self.score[:, self.col[name]] >= MEMBER

    def guesses(self):
        rows_by_artist = {}
        for row, a in enumerate(self.artist_ids.tolist()):
            if a and not self.tagged[row]:
                rows_by_artist.setdefault(a, []).append(row)
        out = {}
        for a, rows in rows_by_artist.items():
            mean = self.score[rows].mean(axis=0)
            top = [self.names[j] for j in np.argsort(-mean)[:3] if mean[j] >= MEMBER]
            if top:
                out[a] = top
        return out


def signature(ctx, corpus):
    row = ctx.db.one("select count(*), coalesce(max(checked_at), '') from artist_genres")
    stamp = PROBES.stat().st_mtime if PROBES.exists() else 0
    return (corpus.stamp, tuple(row), stamp)


def index(ctx, corpus):
    corpus.refresh()
    key = signature(ctx, corpus)
    with _INDEX_LOCK:
        if _INDEX["key"] == key:
            return _INDEX["value"]
    built = GenreIndex(ctx, corpus)
    guesses = {a: json.dumps(names) for a, names in built.guesses().items()}
    stored = {r[0]: r[1] for r in ctx.db.q("select artist_id, genres from artist_genre_guess")}
    stale = [a for a in stored if a not in guesses]
    changed = [(a, v) for a, v in guesses.items() if stored.get(a) != v]
    if stale or changed:
        with ctx.db.tx():
            for a in stale:
                ctx.db.x("delete from artist_genre_guess where artist_id=?", (a,))
            for a, v in changed:
                ctx.db.x("insert or replace into artist_genre_guess(artist_id, genres) values(?,?)", (a, v))
    with _INDEX_LOCK:
        _INDEX.update(key=key, value=built)
    return built


def track_genres(db, artist_ids):
    artist_ids = [a for a in set(artist_ids) if a]
    out = {}
    if not artist_ids:
        return out
    marks = ",".join("?" * len(artist_ids))
    for r in db.q(f"select artist_id, genres from artist_genres where artist_id in ({marks}) "
                  "and genres is not null and genres != '{}'", artist_ids):
        counts = json.loads(r["genres"])
        ordered = sorted(counts.items(), key=lambda kv: -kv[1])
        out[r["artist_id"]] = [pretty(ALIASES.get(g, g)) for g, _ in ordered[:3]]
    for r in db.q(f"select artist_id, genres from artist_genre_guess where artist_id in ({marks})", artist_ids):
        out.setdefault(r["artist_id"], [pretty(g) for g in json.loads(r["genres"])])
    return out
