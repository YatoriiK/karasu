import json
import threading
from datetime import date

from rapidfuzz import fuzz

from .net import NetError
from .util import days_since, norm_artist, norm_title, now, now_iso, track_key, year_of


def artist_match(a, b):
    na, nb = norm_artist(a), norm_artist(b)
    if not na or not nb:
        return False
    if na == nb or fuzz.ratio(na, nb) >= 88:
        return True
    short, long_ = sorted((na, nb), key=len)
    return len(short) >= 4 and (long_.startswith(short + " ") or long_.endswith(" " + short))


def title_match(a, b, threshold=88):
    na, nb = norm_title(a), norm_title(b)
    return bool(na and nb) and (na == nb or fuzz.ratio(na, nb) >= threshold)


def store_dz_track(db, t, album=None):
    if not t or not t.get("id"):
        return None
    artist = t.get("artist") or {}
    alb = album or t.get("album") or {}
    md5 = t.get("md5_image") or alb.get("md5_image")
    bpm = t.get("bpm") or None
    explicit = t.get("explicit_lyrics")
    db.x(
        "insert into dz_tracks(id, title, artist_id, artist, album_id, album, isrc, duration, rank, release_date, key, "
        "md5, bpm, gain, explicit) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set "
        "isrc=coalesce(excluded.isrc, dz_tracks.isrc), rank=coalesce(excluded.rank, dz_tracks.rank), "
        "release_date=coalesce(excluded.release_date, dz_tracks.release_date), "
        "album=coalesce(excluded.album, dz_tracks.album), album_id=coalesce(excluded.album_id, dz_tracks.album_id), "
        "md5=coalesce(excluded.md5, dz_tracks.md5), bpm=coalesce(excluded.bpm, dz_tracks.bpm), "
        "gain=coalesce(excluded.gain, dz_tracks.gain), explicit=coalesce(excluded.explicit, dz_tracks.explicit)",
        (
            t["id"], t.get("title"), artist.get("id"), artist.get("name"), alb.get("id"), alb.get("title"),
            t.get("isrc"), t.get("duration"), t.get("rank"), t.get("release_date") or alb.get("release_date"),
            track_key(artist.get("name"), t.get("title")), md5, bpm, t.get("gain"),
            None if explicit is None else int(bool(explicit)),
        ),
    )
    return t["id"]


def seed_to_deezer(ctx, row):
    cached = ctx.db.one("select dz_id from sp_dz where sp_id=?", (row["id"],))
    if cached:
        return cached[0] if cached[0] > 0 else None
    artists = json.loads(row["artists"] or "[]")
    dz_id = None
    try:
        if row["isrc"]:
            t = ctx.dz.track_by_isrc(row["isrc"])
            if t and any(artist_match((t.get("artist") or {}).get("name"), a) for a in artists):
                dz_id = store_dz_track(ctx.db, t)
        if dz_id is None and artists:
            for t in ctx.dz.search_track(artists[0], row["name"], limit=5):
                if artist_match((t.get("artist") or {}).get("name"), artists[0]) and title_match(t.get("title"), row["name"], 90):
                    dz_id = store_dz_track(ctx.db, t)
                    break
    except NetError as exc:
        ctx.log(f"  deezer lookup failed for {row['name']}: {exc}")
        return None
    ctx.db.x("insert or replace into sp_dz(sp_id, dz_id) values(?,?)", (row["id"], dz_id or -1))
    return dz_id


def deezer_artist(ctx, name, titles=None):
    target = norm_artist(name)
    if not target:
        return None
    found = [a for a in ctx.dz.search_artist(name, limit=10) if norm_artist(a.get("name")) == target]
    if not found:
        return None
    if len(found) == 1:
        return found[0]
    found.sort(key=lambda a: -(a.get("nb_fan") or 0))
    if titles is None:
        titles = ctx.lfm.top_tracks(name, 30) if ctx.lfm.enabled else []
    wanted = {norm_title(t) for t in titles if t}
    if wanted:
        best, best_overlap = None, 0
        for artist in found[:4]:
            top = {norm_title(t.get("title")) for t in ctx.dz.artist_top(artist["id"], limit=25)}
            overlap = len(top & wanted)
            if overlap > best_overlap:
                best, best_overlap = artist, overlap
        if best_overlap >= 2:
            return best
    first, second = found[0], found[1]
    if (first.get("nb_fan") or 0) >= 10 * max(1, second.get("nb_fan") or 0):
        return first
    return None


def artist_profile(ctx, dz_id, name=None, max_age_days=14):
    row = ctx.db.one("select * from dz_artists where id=?", (dz_id,))
    if row and row["checked_at"] and (days_since(row["checked_at"]) or 99) < max_age_days:
        return dict(row)
    info = ctx.dz.artist(dz_id) or {}
    albums = ctx.dz.artist_albums(dz_id, limit=100)
    dates = sorted(a.get("release_date") for a in albums if year_of(a.get("release_date")))
    cutoff = now().toordinal() - 183
    pace = 0
    for value in dates:
        try:
            if _ordinal(value) >= cutoff:
                pace += 1
        except ValueError:
            pass
    profile = {
        "id": dz_id,
        "name": info.get("name") or name,
        "norm": norm_artist(info.get("name") or name),
        "fans": info.get("nb_fan"),
        "nb_album": info.get("nb_album"),
        "earliest": dates[0] if dates else None,
        "latest": dates[-1] if dates else None,
        "pace_6m": pace,
        "mb_earliest": row["mb_earliest"] if row else None,
        "checked_at": now_iso(),
        "album_titles": [a.get("title") for a in albums],
    }
    ctx.db.x(
        "insert or replace into dz_artists(id, name, norm, fans, nb_album, earliest, latest, pace_6m, mb_earliest, "
        "checked_at) values(?,?,?,?,?,?,?,?,?,?)",
        (dz_id, profile["name"], profile["norm"], profile["fans"], profile["nb_album"], profile["earliest"],
         profile["latest"], pace, profile["mb_earliest"], profile["checked_at"]),
    )
    return profile


def _ordinal(value):
    parts = (value + "-01-01").split("-")
    return date(int(parts[0]), max(1, int(parts[1] or 1)), max(1, int(parts[2] or 1))).toordinal()


def mb_artist_cached(ctx, dz_id):
    row = ctx.db.one("select mb_earliest from dz_artists where id=?", (dz_id,))
    if not row or not row[0]:
        return False, None
    return True, (year_of(row[0]) if row[0] != "none" else None)


def mb_artist_earliest(ctx, dz_id, name, album_titles=()):
    cached, year = mb_artist_cached(ctx, dz_id)
    if cached:
        return year
    try:
        artists = ctx.mb.search_artist(name, limit=5)
    except NetError:
        return None
    exact = [a for a in artists if norm_artist(a.get("name")) == norm_artist(name) and int(a.get("score") or 0) >= 90]
    best_year = None
    wanted = {norm_title(t) for t in album_titles if t}
    for artist in exact[:3]:
        try:
            groups = ctx.mb.release_groups(artist["id"])
        except NetError:
            continue
        if len(exact) > 1 and wanted and not ({norm_title(g.get("title")) for g in groups} & wanted):
            continue
        years = [year_of(g.get("first-release-date")) for g in groups]
        if artist.get("type") == "Group":
            years.append(year_of((artist.get("life-span") or {}).get("begin")))
        years = [y for y in years if y]
        if years:
            best_year = min(years) if best_year is None else min(best_year, min(years))
        if len(exact) == 1 or best_year:
            break
    ctx.db.x("update dz_artists set mb_earliest=? where id=?", (str(best_year) if best_year else "none", dz_id))
    return best_year


class Budget:
    def __init__(self, count):
        self.left = int(count)
        self.lock = threading.Lock()

    def take(self):
        with self.lock:
            if self.left <= 0:
                return False
            self.left -= 1
            return True


def original_year(ctx, dz_id, discogs_year=None, accept_below=None, budget=None):
    row = ctx.db.one("select original_year, year_source from dz_tracks where id=?", (dz_id,))
    if row and row["original_year"]:
        year, source = row["original_year"], row["year_source"]
        if discogs_year and discogs_year < year:
            year, source = discogs_year, "discogs"
        return year, source
    t = ctx.dz.track(dz_id)
    if not t or not t.get("id"):
        return (discogs_year, "discogs") if discogs_year else (None, None)
    store_dz_track(ctx.db, t)
    title = t.get("title") or ""
    artist = (t.get("artist") or {}).get("name") or ""
    found = []
    dates = [year_of(t.get("release_date")), year_of((t.get("album") or {}).get("release_date"))]
    deezer_year = min([y for y in dates if y], default=None)
    if deezer_year:
        found.append((deezer_year, "deezer"))
    if discogs_year:
        found.append((discogs_year, "discogs"))
    if accept_below is not None and found and min(found)[0] <= accept_below:
        return min(found)
    if budget is not None and not budget.take():
        return min(found) if found else (None, None)
    mb_years = []
    try:
        if t.get("isrc"):
            for rec in ctx.mb.isrc_recordings(t["isrc"]):
                credits = [c.get("name") for c in rec.get("artist-credit") or [] if isinstance(c, dict)]
                if not credits or any(artist_match(c, artist) for c in credits):
                    mb_years.append(year_of(rec.get("first-release-date")))
        if not [y for y in mb_years if y]:
            for rec in ctx.mb.search_recordings(artist, title, limit=10):
                if int(rec.get("score") or 0) < 90 or not title_match(rec.get("title"), title, 92):
                    continue
                credits = [c.get("name") for c in rec.get("artist-credit") or [] if isinstance(c, dict)]
                if any(artist_match(c, artist) for c in credits):
                    mb_years.append(year_of(rec.get("first-release-date")))
    except NetError as exc:
        ctx.log(f"  musicbrainz lookup failed for {artist} - {title}: {exc}")
    mb_years = [y for y in mb_years if y]
    if mb_years:
        found.append((min(mb_years), "musicbrainz"))
    if not found:
        return None, None
    year, source = min(found)
    ctx.db.x("update dz_tracks set original_year=?, year_source=? where id=?", (year, source, dz_id))
    return year, source


def spotify_match(ctx, dz_track):
    title = dz_track.get("title") or ""
    artist = (dz_track.get("artist") or {}).get("name") or ""
    isrc = dz_track.get("isrc")

    def fits(item, strict):
        if item.get("is_playable") is False:
            return False
        names = [a.get("name") for a in item.get("artists") or []]
        if not any(artist_match(n, artist) for n in names):
            return False
        return title_match(item.get("name"), title, 92 if strict else 85)

    good = []
    if isrc:
        good = [i for i in ctx.sp.search_tracks(f"isrc:{isrc}", limit=5) if fits(i, False)]
    if not good:
        query = f'track:"{title.replace(chr(34), "")}" artist:"{artist.replace(chr(34), "")}"'
        good = [i for i in ctx.sp.search_tracks(query, limit=5) if fits(i, True)]
    if not good:
        return None
    good.sort(key=lambda i: (
        (i.get("album") or {}).get("album_type") == "compilation",
        (i.get("album") or {}).get("release_date") or "9999",
    ))
    return good[0]
