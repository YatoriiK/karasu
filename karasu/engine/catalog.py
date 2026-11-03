import json

from ..util import norm_artist, year_of
from . import facets as F
from .genres import track_genres
from .media import cached_palettes


def tier(fans):
    if fans is None:
        return None
    if fans < 1000:
        return "underground"
    if fans < 10000:
        return "niche"
    if fans < 100000:
        return "known"
    return "popular"


def _in(db, sql, ids, extra=()):
    ids = list(ids)
    rows = []
    for i in range(0, len(ids), 800):
        part = ids[i:i + 800]
        rows += db.q(sql.format(marks=",".join("?" * len(part))), list(extra) + part)
    return rows


def art_ref(md5=None, sp_image=None):
    if md5:
        return ("cover", md5)
    if sp_image and "/image/" in sp_image:
        return ("sp", sp_image.rsplit("/", 1)[-1])
    return None


def art_payload(ref, palettes):
    if not ref:
        return None
    kind, key = ref
    return {"kind": kind, "ref": key, "src": f"/api/art/{kind}/{key}?s=320",
            "palette": palettes.get(f"{kind}:{key}")}


def parse_id(value):
    if isinstance(value, int):
        return "dz", value
    text = str(value)
    if text.startswith("dz:"):
        return "dz", int(text[3:])
    if text.startswith("sp:"):
        return "sp", text[3:]
    if text.isdigit():
        return "dz", int(text)
    return "sp", text


class Catalog:
    def __init__(self, db):
        self.db = db

    def _dz_maps(self, dz_ids):
        db = self.db
        rows = {r["id"]: dict(r) for r in _in(db, "select * from dz_tracks where id in ({marks})", dz_ids)}
        artist_ids = {r["artist_id"] for r in rows.values() if r.get("artist_id")}
        artists = {r["id"]: dict(r) for r in _in(db, "select id, fans, picture from dz_artists where id in ({marks})",
                                                  artist_ids)}
        sp = {}
        for r in _in(db, "select dz_id, sp_id from dz_sp where dz_id in ({marks}) and sp_id is not null", dz_ids):
            sp[r["dz_id"]] = r["sp_id"]
        for r in _in(db, "select dz_id, sp_id from sp_dz where dz_id in ({marks})", dz_ids):
            sp.setdefault(r["dz_id"], r["sp_id"])
        for r in _in(db, "select dz_id, sp_id from recs where sp_id is not null and dz_id in ({marks})", dz_ids):
            sp.setdefault(r["dz_id"], r["sp_id"])
        saved = {r[0] for r in _in(db, "select track_id from saved where track_id in ({marks})", set(sp.values()))}
        votes = {}
        for r in _in(db, "select dz_id, kind from feedback where dz_id in ({marks}) order by id", dz_ids):
            votes[r["dz_id"]] = r["kind"]
        nopreview = {int(r[0].split(":", 1)[1]) for r in
                     _in(db, "select key from meta where key in ({marks})", [f"nopreview:{i}" for i in dz_ids])}
        dsp = {r["dz_id"]: dict(r) for r in _in(db, "select dz_id, tempo, energy from dsp where dz_id in ({marks})",
                                                 dz_ids)}
        fac = F.load(db, dz_ids)
        return rows, artists, sp, saved, votes, nopreview, dsp, fac

    def tracks(self, ids, extra=None):
        extra = extra or {}
        parsed = [parse_id(i) for i in ids]
        dz_ids = [v for k, v in parsed if k == "dz"]
        sp_ids = [v for k, v in parsed if k == "sp"]
        rows, artists, sp, saved, votes, nopreview, dsp, fac = self._dz_maps(dz_ids) if dz_ids else ({},) * 8
        sp_rows = {r["id"]: dict(r) for r in _in(self.db, "select * from sp_tracks where id in ({marks})", sp_ids)}
        lib_saved = {r[0] for r in _in(self.db, "select track_id from saved where track_id in ({marks})", sp_ids)}
        hidden = {r[0] for r in self.db.q("select value from exclusions where kind='artist'")}
        blocked = {r[0] for r in self.db.q("select value from exclusions where kind='track'")}
        genre_of = track_genres(self.db, [r.get("artist_id") for r in rows.values()]) if dz_ids else {}
        refs = []
        for kind, value in parsed:
            if kind == "dz" and value in rows:
                refs.append(art_ref(rows[value].get("md5")))
            elif kind == "sp" and value in sp_rows:
                refs.append(art_ref(sp_image=sp_rows[value].get("image")))
        palettes = cached_palettes(self.db, [f"{r[0]}:{r[1]}" for r in refs if r])
        out = []
        for (kind, value), original in zip(parsed, ids):
            more = extra.get(original) or extra.get(f"{kind}:{value}") or {}
            if kind == "dz":
                row = rows.get(value)
                if not row:
                    continue
                artist = artists.get(row.get("artist_id")) or {}
                sp_id = sp.get(value)
                fvec = fac.get(value)
                d = dsp.get(value) or {}
                year = row.get("original_year") or year_of(row.get("release_date"))
                out.append({
                    "id": f"dz:{value}",
                    "dz_id": value,
                    "sp_id": sp_id,
                    "sp_uri": f"spotify:track:{sp_id}" if sp_id else None,
                    "title": row.get("title"),
                    "artist": {"name": row.get("artist"), "key": norm_artist(row.get("artist")),
                               "dz_id": row.get("artist_id")},
                    "album": {"title": row.get("album"), "dz_id": row.get("album_id")},
                    "year": year,
                    "year_source": row.get("year_source") or ("deezer" if year else None),
                    "duration_s": row.get("duration"),
                    "art": art_payload(art_ref(row.get("md5")), palettes),
                    "has_preview": value not in nopreview,
                    "facets": {
                        "energy": F.energy_value(fvec),
                        "tempo": d.get("tempo") or (row.get("bpm") or None),
                        "top": F.top_labels(fvec) if fvec is not None else [],
                        "genres": genre_of.get(row.get("artist_id")) or [],
                    },
                    "popularity": {"fans": artist.get("fans"), "tier": tier(artist.get("fans"))},
                    "state": {
                        "liked": votes.get(value) == "up",
                        "disliked": votes.get(value) == "down",
                        "hidden": norm_artist(row.get("artist")) in hidden or f"dz:{value}" in blocked,
                        "saved": bool(sp_id and sp_id in saved),
                    },
                    "reasons": more.get("reasons", []),
                    "score": more.get("score"),
                })
            else:
                row = sp_rows.get(value)
                if not row:
                    continue
                names = json.loads(row.get("artists") or "[]")
                out.append({
                    "id": f"sp:{value}",
                    "dz_id": None,
                    "sp_id": value,
                    "sp_uri": f"spotify:track:{value}",
                    "title": row.get("name"),
                    "artist": {"name": names[0] if names else None, "key": norm_artist(names[0] if names else ""),
                               "dz_id": None},
                    "album": {"title": row.get("album"), "dz_id": None},
                    "year": year_of(row.get("release_date")),
                    "year_source": "spotify",
                    "duration_s": round((row.get("duration_ms") or 0) / 1000) or None,
                    "art": art_payload(art_ref(sp_image=row.get("image")), palettes),
                    "has_preview": False,
                    "facets": {"energy": None, "tempo": None, "top": [], "genres": []},
                    "popularity": {"fans": None, "tier": None},
                    "state": {"liked": False, "disliked": False, "hidden": False, "saved": value in lib_saved},
                    "reasons": more.get("reasons", []),
                    "score": more.get("score"),
                })
        return out

    def library_ids(self, sp_ids):
        mapping = {r["sp_id"]: r["dz_id"] for r in
                   _in(self.db, "select sp_id, dz_id from sp_dz where sp_id in ({marks})", sp_ids)}
        return [f"dz:{mapping[s]}" if mapping.get(s, -1) > 0 else f"sp:{s}" for s in sp_ids]

    def artists(self, dz_ids):
        rows = {r["id"]: dict(r) for r in _in(self.db, "select * from dz_artists where id in ({marks})", dz_ids)}
        covers = {}
        for r in _in(self.db, "select artist_id, md5 from dz_tracks where md5 is not null and artist_id in ({marks}) "
                              "group by artist_id", dz_ids):
            covers[r["artist_id"]] = r["md5"]
        refs = []
        for i in dz_ids:
            row = rows.get(i) or {}
            refs.append(("artist", row["picture"]) if row.get("picture") else art_ref(covers.get(i)))
        palettes = cached_palettes(self.db, [f"{r[0]}:{r[1]}" for r in refs if r])
        out = []
        for i, ref in zip(dz_ids, refs):
            row = rows.get(i)
            if not row:
                continue
            out.append({
                "dz_id": i,
                "name": row.get("name"),
                "key": row.get("norm") or norm_artist(row.get("name")),
                "fans": row.get("fans"),
                "tier": tier(row.get("fans")),
                "art": art_payload(ref, palettes),
                "first_year": year_of(row.get("mb_earliest")) or year_of(row.get("earliest")),
            })
        return out
