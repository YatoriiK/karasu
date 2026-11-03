import colorsys
import hashlib
import io
import json
import os
import re
import threading
import time
import unicodedata

from PIL import Image

from .. import CACHE
from ..net import NetError
from ..util import now_iso

ART = CACHE / "art"
SIZES = (64, 160, 320, 640, 1000)
KINDS = {
    "cover": "https://e-cdns-images.dzcdn.net/images/cover/{ref}/1000x1000-000000-80-0-0.jpg",
    "artist": "https://e-cdns-images.dzcdn.net/images/artist/{ref}/1000x1000-000000-80-0-0.jpg",
    "sp": "https://i.scdn.co/image/{ref}",
}
BLANK_COVERS = {"f75ba0ba49d9cd2604be97e7b6964817"}
BLANK_RETRY = 3600
_locks = {}
_locks_guard = threading.Lock()
_blank = {}


def _lock(key):
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def valid(kind, ref):
    return kind in KINDS and ref and all(c.isalnum() for c in ref) and len(ref) <= 64


def source_path(kind, ref):
    return ART / "src" / kind / f"{ref}.jpg"


def sized_path(kind, ref, size):
    return ART / str(size) / kind / f"{ref}.webp"


def is_placeholder(data):
    if not data:
        return False
    if hashlib.md5(data).hexdigest() in BLANK_COVERS:
        return True
    if len(data) > 60000:
        return False
    try:
        with Image.open(io.BytesIO(data)) as img:
            raw = img.convert("RGB").resize((32, 32)).tobytes()
    except Exception:
        return False
    pixels = [raw[i:i + 3] for i in range(0, len(raw), 3)]
    pale = sum(1 for r, g, b in pixels if min(r, g, b) >= 180 and max(r, g, b) - min(r, g, b) <= 14)
    paper = sum(1 for r, g, b in pixels if abs(r - 233) <= 6 and abs(g - 231) <= 6 and abs(b - 238) <= 6)
    return pale == len(pixels) and paper >= len(pixels) * 0.6


def spotify_image(ctx, sp_id):
    row = ctx.db.one("select image from sp_tracks where id=?", (sp_id,))
    url = row[0] if row and row[0] else None
    if not url:
        images = ((ctx.sp.track(sp_id) or {}).get("album") or {}).get("images") or []
        url = images[0].get("url") if images else None
    return url.replace("ab67616d00001e02", "ab67616d0000b273") if url else None


def spotify_cover(ctx, md5):
    from ..resolve import spotify_match
    rows = ctx.db.q(
        "select t.id, t.title, t.artist, t.isrc, s.dz_id checked, coalesce(s.sp_id, x.sp_id) sp_id from dz_tracks t "
        "left join dz_sp s on s.dz_id=t.id left join sp_dz x on x.dz_id=t.id where t.md5=? limit 3", (md5,))
    for row in rows:
        sp_id = row["sp_id"]
        try:
            if not sp_id and row["checked"] is None:
                match = spotify_match(ctx, {"title": row["title"], "artist": {"name": row["artist"]}, "isrc": row["isrc"]})
                sp_id = match["id"] if match else None
                ctx.db.x("insert or replace into dz_sp(dz_id, sp_id, checked_at) values(?,?,?)",
                         (row["id"], sp_id, now_iso()))
            url = spotify_image(ctx, sp_id) if sp_id else None
        except Exception:
            continue
        data = ctx.net.get_bytes(url) if url else None
        if data:
            return data
    return None


def artist_cover(ctx, picture):
    row = ctx.db.one("select t.md5 from dz_tracks t join dz_artists a on a.id=t.artist_id "
                     "where a.picture=? and t.md5 is not null limit 1", (picture,))
    src = ensure_source(ctx, "cover", row[0]) if row else None
    return src.read_bytes() if src else None


def forget_placeholders(db):
    found = []
    for kind in ("cover", "artist"):
        root = ART / "src" / kind
        if root.exists():
            found += [(kind, p.stem) for p in root.glob("*.jpg")
                      if p.stat().st_size <= 60000 and is_placeholder(p.read_bytes())]
    for kind, ref in found:
        source_path(kind, ref).unlink(missing_ok=True)
        for size in SIZES:
            sized_path(kind, ref, size).unlink(missing_ok=True)
        db.x("delete from art_palette where key=?", (f"{kind}:{ref}",))
    return {"placeholders": len(found)}


def ensure_source(ctx, kind, ref):
    path = source_path(kind, ref)
    if path.exists():
        return path
    key = f"{kind}:{ref}"
    if time.monotonic() - _blank.get(key, -BLANK_RETRY) < BLANK_RETRY:
        return None
    with _lock(key):
        if path.exists():
            return path
        data = ctx.net.get_bytes(KINDS[kind].format(ref=ref))
        if kind != "sp" and is_placeholder(data):
            data = spotify_cover(ctx, ref) if kind == "cover" else artist_cover(ctx, ref)
            if not data:
                _blank[key] = time.monotonic()
        if not data:
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return path


def ensure_sized(ctx, kind, ref, size):
    size = min(SIZES, key=lambda s: abs(s - int(size)))
    out = sized_path(kind, ref, size)
    if out.exists():
        return out
    src = ensure_source(ctx, kind, ref)
    if src is None:
        return None
    try:
        palette(ctx, kind, ref)
    except Exception:
        pass
    with _lock(f"{kind}:{ref}:{size}"):
        if out.exists():
            return out
        with Image.open(src) as img:
            img = img.convert("RGB")
            img.thumbnail((size, size), Image.LANCZOS)
            out.parent.mkdir(parents=True, exist_ok=True)
            buffer = io.BytesIO()
            img.save(buffer, "WEBP", quality=86, method=4)
        tmp = out.with_suffix(".part")
        tmp.write_bytes(buffer.getvalue())
        os.replace(tmp, out)
    return out


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def to_oklch(rgb):
    r, g, b = (_srgb_to_linear(v / 255.0) for v in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    import math
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


def from_oklch(L, C, H):
    import math
    A, B = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(round(_linear_to_srgb(v) * 255) for v in (r, g, b))


def _hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v))) for v in rgb)


def palette_from_image(path):
    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((96, 96))
        quant = img.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
        pal = quant.getpalette()[:24]
        counts = sorted(quant.getcolors(), reverse=True)
    swatches = []
    total = sum(c for c, _ in counts) or 1
    for count, index in counts:
        rgb = tuple(pal[index * 3:index * 3 + 3])
        L, C, H = to_oklch(rgb)
        swatches.append({"rgb": rgb, "share": count / total, "L": L, "C": C, "H": H})
    if not swatches:
        return None
    vivid = max(swatches, key=lambda s: s["C"] * (0.35 + s["share"]) * (1.0 if 0.25 < s["L"] < 0.92 else 0.4))
    dominant = max(swatches, key=lambda s: s["share"])
    hue = vivid["H"] if vivid["C"] > 0.04 else dominant["H"]
    chroma = min(max(vivid["C"], 0.06), 0.16) if vivid["C"] > 0.04 else 0.03
    accent = from_oklch(0.74, chroma, hue)
    glow = from_oklch(0.55, min(chroma * 1.1, 0.17), hue)
    base = from_oklch(0.2, min(dominant["C"], 0.05), dominant["H"])
    deep = from_oklch(0.13, min(dominant["C"] * 0.6, 0.03), dominant["H"])
    return {
        "accent": _hex(accent),
        "glow": _hex(glow),
        "base": _hex(base),
        "deep": _hex(deep),
        "swatches": [_hex(s["rgb"]) for s in swatches[:6]],
        "light": dominant["L"] > 0.7,
    }


def palette(ctx, kind, ref):
    key = f"{kind}:{ref}"
    row = ctx.db.one("select palette from art_palette where key=?", (key,))
    if row:
        return json.loads(row[0]) if row[0] else None
    src = ensure_source(ctx, kind, ref)
    if src is None:
        return None
    result = palette_from_image(src)
    ctx.db.x("insert or replace into art_palette(key, palette) values(?,?)",
             (key, json.dumps(result) if result else None))
    return result


def cached_palettes(db, keys):
    keys = list(keys)
    out = {}
    for i in range(0, len(keys), 900):
        part = keys[i:i + 900]
        for row in db.q(f"select key, palette from art_palette where key in ({','.join('?' * len(part))})", part):
            out[row["key"]] = json.loads(row["palette"]) if row["palette"] else None
    return out


_NOISE = re.compile(
    r"\s*[\(\[][^)\]]*(?:remaster|live|version|edit|mix|mono|stereo|demo|deluxe|bonus|feat\.?|ft\.|with |radio|"
    r"explicit|clean|acoustic|session|take|outtake)[^)\]]*[\)\]]", re.I)
_DASH = re.compile(r"\s+-\s+.*\b(?:remaster(?:ed)?|live|version|edit|mix|mono|stereo|demo|radio)\b.*$", re.I)


def clean_title(title):
    cleaned = _DASH.sub("", _NOISE.sub("", title or "")).strip()
    return cleaned or (title or "")


LRCLIB = "https://lrclib.net/api"
LYRICS_TTL = 30 * 86400
LYRICS_MISS_TTL = 3 * 86400
LYRICS_PATIENCE = 10.0
_BRACKETS = re.compile(r"\s*[\(\[][^)\]]*[\)\]]")
_FEAT = re.compile(r"\s+(?:feat\.?|ft\.|featuring)\s.*$", re.I)


def bare_title(title):
    return _FEAT.sub("", _BRACKETS.sub("", title or "").split(" - ")[0]).strip() or (title or "")


def _key(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    return " ".join(re.sub(r"[\W_]+", " ", text).split())


def _same_title(a, b):
    return bool(_key(a)) and (_key(clean_title(a)) == _key(clean_title(b)) or _key(bare_title(a)) == _key(bare_title(b)))


def _same_artist(a, b):
    a, b = _key(a), _key(b)
    return bool(a and b) and (f" {a} " in f" {b} " or f" {b} " in f" {a} ")


def _fits(item, sig):
    if not (_same_title(item.get("trackName"), sig["title"]) and _same_artist(item.get("artistName"), sig["artist"])):
        return False
    have, want = item.get("duration"), sig.get("duration")
    return not (have and want) or abs(float(have) - float(want)) <= 4


def _pick(hits, sigs):
    good = [h for h in hits or [] if isinstance(h, dict) and any(_fits(h, s) for s in sigs)]
    want = sigs[0].get("duration") or 0
    good.sort(key=lambda h: (not h.get("syncedLyrics"), not h.get("plainLyrics"),
                             abs(float(h.get("duration") or want) - want)))
    return good[0] if good else None


def _lyric_requests(sigs):
    seen, out = set(), []

    def add(path, **params):
        params = {k: (int(round(v)) if k == "duration" else v) for k, v in params.items() if v}
        key = (path, tuple(sorted((k, v if k == "duration" else _key(v)) for k, v in params.items())))
        if key not in seen:
            seen.add(key)
            out.append((path, params))

    first = sigs[0]
    add("get", artist_name=first["artist"], track_name=first["title"], album_name=first.get("album"),
        duration=first.get("duration"))
    add("get", artist_name=first["artist"], track_name=first["title"], duration=first.get("duration"))
    add("get", artist_name=first["artist"], track_name=clean_title(first["title"]), duration=first.get("duration"))
    for sig in sigs[1:2]:
        add("get", artist_name=sig["artist"], track_name=sig["title"], album_name=sig.get("album"),
            duration=sig.get("duration"))
    add("search", track_name=bare_title(first["title"]), artist_name=first["artist"])
    add("search", q=f"{first['artist']} {bare_title(first['title'])}")
    return out


def _lyrics_found(data):
    return {"status": "ok", "instrumental": bool(data.get("instrumental")), "plain": data.get("plainLyrics"),
            "synced": parse_lrc(data.get("syncedLyrics")), "source": "LRCLIB"}


def _lrclib(ctx, path, params, deadline):
    while True:
        try:
            return ctx.net.request("GET", f"{LRCLIB}/{path}", params=params, attempts=1, miss_ttl=LYRICS_MISS_TTL,
                                   ttl=LYRICS_TTL if path == "get" else LYRICS_MISS_TTL)
        except NetError as exc:
            if exc.status not in (429, 500, 502, 503, 504) or time.monotonic() >= deadline:
                raise


def lyrics(ctx, sigs):
    sigs = [s for s in sigs if s and s.get("artist") and s.get("title")]
    deadline = time.monotonic() + LYRICS_PATIENCE
    plain = None
    busy = False
    for path, params in _lyric_requests(sigs) if sigs else []:
        try:
            data = _lrclib(ctx, path, params, deadline)
        except NetError:
            busy = True
            break
        hit = _pick(data, sigs) if path == "search" else data
        if not hit:
            continue
        if hit.get("syncedLyrics") or (hit.get("instrumental") and path == "get"):
            return _lyrics_found(hit)
        if plain is None and hit.get("plainLyrics"):
            plain = _lyrics_found(hit)
    if plain:
        return plain
    return {"status": "busy" if busy else "missing", "instrumental": False, "plain": None, "synced": None,
            "source": "LRCLIB" if busy else None}


def parse_lrc(text):
    if not text:
        return None
    import re
    out = []
    for line in text.splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", line)
        words = re.sub(r"\[[^\]]*\]", "", line).strip()
        for minutes, seconds in stamps:
            out.append({"t": round(int(minutes) * 60 + float(seconds), 2), "text": words})
    out.sort(key=lambda x: x["t"])
    return out or None
