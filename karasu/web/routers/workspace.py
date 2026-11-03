import asyncio
import hashlib
import io
import json
import mimetypes
import re
import threading

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ... import DATA
from ...util import now_iso
from ..state import ctx

router = APIRouter(prefix="/api")

ASSETS = DATA / "assets"
THUMBS = ASSETS / "thumbs"
MAX_ASSET = 60 * 1024 * 1024
MAX_VIDEO = 250 * 1024 * 1024
EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
       "image/svg+xml": ".svg", "image/bmp": ".bmp", "video/mp4": ".mp4", "video/webm": ".webm"}
PIL_MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif", "BMP": "image/bmp",
            "AVIF": "image/avif"}
IMAGE_BRANDS = (b"avif", b"avis", b"heic", b"heix", b"heim", b"heis", b"mif1", b"msf1")
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
CANVAS = {"w": 1280, "h": 620}


def item(id_, kind, x, y, w, h, z, props=None, style=None):
    return {"id": id_, "kind": kind, "x": x, "y": y, "w": w, "h": h, "r": 0, "z": z, "hidden": False,
            "locked": False, "style": style or {}, "props": props or {}}


def default_layout():
    return {
        "canvas": dict(CANVAS),
        "grid": 8,
        "wallpaper": {"asset": None, "fit": "cover", "position": "center", "dim": 0.25, "blur": 0, "mono": True},
        "items": [
            item("clock", "clock", 24, 12, 380, 124, 1, {"format": "12", "date": "jp"},
                 {"titlebar": "none", "bg": "none", "border": 0, "shadow": "none"}),
            item("search", "search", 420, 22, 440, 50, 2),
            item("nowplaying", "nowplaying", 24, 150, 272, 440, 3),
            item("sotd", "sotd", 900, 16, 356, 226, 4),
            item("challenge", "challenge", 900, 258, 356, 128, 5),
            item("visualizer", "visualizer", 900, 402, 356, 188, 6, {"bars": 24}),
            item("fetch", "fetch", 320, 380, 556, 210, 7),
        ],
    }


def _payload(row):
    data = json.loads(row["data"] or "{}")
    return {"id": row["id"], "name": row["name"], "pos": row["pos"], "updated": row["updated"], "data": data}


def _rows(db):
    return db.q("select * from layouts order by pos, id")


@router.get("/layouts")
def list_layouts():
    db = ctx().db
    rows = _rows(db)
    if not rows:
        stamp = now_iso()
        db.x("insert into layouts(name, data, pos, created, updated) values(?,?,?,?,?)",
             ("Sumi", json.dumps(default_layout()), 0, stamp, stamp))
        rows = _rows(db)
    ids = [r["id"] for r in rows]
    active = db.meta("active_layout")
    return {"active": active if active in ids else ids[0], "layouts": [_payload(r) for r in rows]}


class LayoutBody(BaseModel):
    name: str | None = None
    data: dict | None = None


@router.post("/layouts")
def create_layout(body: LayoutBody):
    db = ctx().db
    stamp = now_iso()
    pos = (db.one("select coalesce(max(pos), -1) from layouts")[0] or 0) + 1
    data = body.data or default_layout()
    cur = db.x("insert into layouts(name, data, pos, created, updated) values(?,?,?,?,?)",
               ((body.name or "Desk").strip()[:40] or "Desk", json.dumps(data), pos, stamp, stamp))
    db.set_meta("active_layout", cur.lastrowid)
    return _payload(db.one("select * from layouts where id=?", (cur.lastrowid,)))


@router.put("/layouts/{lid}")
def update_layout(lid: int, body: LayoutBody):
    db = ctx().db
    row = db.one("select * from layouts where id=?", (lid,))
    if not row:
        raise HTTPException(404, "unknown layout")
    name = (body.name.strip()[:40] or row["name"]) if body.name is not None else row["name"]
    data = json.dumps(body.data) if body.data is not None else row["data"]
    db.x("update layouts set name=?, data=?, updated=? where id=?", (name, data, now_iso(), lid))
    return _payload(db.one("select * from layouts where id=?", (lid,)))


@router.delete("/layouts/{lid}")
def delete_layout(lid: int):
    db = ctx().db
    if db.one("select count(*) from layouts")[0] <= 1:
        raise HTTPException(400, "keep at least one desk")
    db.x("delete from layouts where id=?", (lid,))
    if db.meta("active_layout") == lid:
        db.set_meta("active_layout", _rows(db)[0]["id"])
    return {"ok": True}


@router.put("/layouts/active/{lid}")
def activate_layout(lid: int):
    db = ctx().db
    if not db.one("select 1 from layouts where id=?", (lid,)):
        raise HTTPException(404, "unknown layout")
    db.set_meta("active_layout", lid)
    return {"active": lid}


class Order(BaseModel):
    ids: list[int]


@router.post("/layouts/order")
def order_layouts(body: Order):
    db = ctx().db
    with db.tx():
        for pos, lid in enumerate(body.ids):
            db.x("update layouts set pos=? where id=?", (pos, lid))
    return {"ok": True}


def _asset(row):
    frames = row["frames"]
    return {"id": row["id"], "name": row["name"], "mime": row["mime"], "w": row["w"], "h": row["h"],
            "bytes": row["bytes"], "created": row["created"], "url": f"/api/assets/{row['id']}",
            "frames": frames, "animated": bool(frames and frames > 1), "video": row["mime"].startswith("video/")}


def _video_mime(data):
    if len(data) > 12 and data[4:8] == b"ftyp" and data[8:12] not in IMAGE_BRANDS and data[8:12] != b"qt  ":
        return "video/mp4"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    return None


def _dim(value):
    return value if isinstance(value, int) and 0 < value <= 16384 else None


def _replace(out, write):
    tmp = out.with_name(f"{out.stem}.{threading.get_ident()}.tmp")
    write(tmp)
    tmp.replace(out)
    return out


def store_asset(db, data, name="image", mime=None, w=None, h=None):
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_VIDEO:
        raise HTTPException(413, "files can be up to 250 MB")
    width = height = None
    frames = 1
    if mime == "image/svg+xml" or data.lstrip()[:5].lower().startswith((b"<svg", b"<?xml")):
        mime = "image/svg+xml"
    elif video := _video_mime(data):
        mime, width, height, frames = video, _dim(w), _dim(h), 0
    else:
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as img:
                width, height = img.size
                mime = PIL_MIME.get(img.format, mime)
                frames = getattr(img, "n_frames", 1)
        except Exception:
            raise HTTPException(415, "that file isn't a picture or video Karasu can read (videos must be MP4 or WebM)")
    if mime not in EXT:
        raise HTTPException(415, "unsupported file type")
    if not mime.startswith("video/") and len(data) > MAX_ASSET:
        raise HTTPException(413, "pictures can be up to 60 MB")
    aid = hashlib.sha1(data).hexdigest()[:16]
    ASSETS.mkdir(parents=True, exist_ok=True)
    path = ASSETS / f"{aid}{EXT[mime]}"
    if not path.exists():
        path.write_bytes(data)
    clean = (name or "image").replace("\\", "/").rsplit("/", 1)[-1][:80]
    existing = db.one("select * from assets where id=?", (aid,))
    if not existing:
        db.x("insert into assets(id, name, file, mime, w, h, bytes, created, frames) values(?,?,?,?,?,?,?,?,?)",
             (aid, clean, path.name, mime, width, height, len(data), now_iso(), frames))
    elif existing["frames"] is None:
        db.x("update assets set frames=? where id=?", (frames, aid))
    return _asset(db.one("select * from assets where id=?", (aid,)))


@router.post("/assets")
async def upload_asset(request: Request, name: str = "image", w: int | None = None, h: int | None = None):
    data = await request.body()
    mime = (request.headers.get("content-type") or "").split(";")[0].strip() or mimetypes.guess_type(name)[0]
    db = ctx().db
    return await asyncio.to_thread(store_asset, db, data, name, mime, w, h)


def _count_frames(row):
    if row["mime"].startswith("video/"):
        return 0
    if row["mime"] == "image/svg+xml":
        return 1
    try:
        from PIL import Image
        with Image.open(ASSETS / row["file"]) as img:
            return getattr(img, "n_frames", 1)
    except Exception:
        return 1


@router.get("/assets")
def list_assets():
    db = ctx().db
    for row in db.q("select * from assets where frames is null"):
        db.x("update assets set frames=? where id=?", (_count_frames(row), row["id"]))
    return [_asset(r) for r in db.q("select * from assets order by created desc")]


def _animated_webp(img, out, size, limit=150):
    from PIL import Image, ImageSequence
    step = max(1, -(-getattr(img, "n_frames", 1) // limit))
    frames, durations = [], []
    for index, frame in enumerate(ImageSequence.Iterator(img)):
        frame.load()
        duration = frame.info.get("duration") or 0
        duration = duration if duration > 10 else 100
        if index % step and durations:
            durations[-1] += duration
            continue
        still = frame.convert("RGBA")
        still.thumbnail((size, size), Image.LANCZOS)
        frames.append(still)
        durations.append(duration)
    frames[0].save(out, "WEBP", save_all=True, append_images=frames[1:], duration=durations, loop=0,
                   quality=80, method=4)


def _thumb(row, size):
    path = ASSETS / row["file"]
    if row["mime"] == "image/svg+xml" or row["mime"].startswith("video/") or not row["w"] \
            or max(row["w"], row["h"]) <= size:
        return path
    frames = row["frames"] if row["frames"] is not None else _count_frames(row)
    if frames > 1 and size > 320:
        return path
    THUMBS.mkdir(parents=True, exist_ok=True)
    out = THUMBS / f"{row['id']}_{size}.webp"
    if out.exists():
        return out
    from PIL import Image

    def write(tmp):
        with Image.open(path) as img:
            if frames > 1:
                _animated_webp(img, tmp, size)
                return
            img = img.convert("RGBA") if img.mode in ("P", "PA", "LA", "RGBA") else img.convert("RGB")
            img.thumbnail((size, size), Image.LANCZOS)
            img.save(tmp, "WEBP", quality=88)

    return _replace(out, write)


@router.get("/assets/{aid}")
async def get_asset(aid: str, s: int | None = None):
    row = ctx().db.one("select * from assets where id=?", (aid,))
    if not row:
        raise HTTPException(404, "unknown image")
    path = ASSETS / row["file"]
    if not path.exists():
        raise HTTPException(404, "image file is missing")
    if s:
        size = min((x for x in (160, 320, 640, 1280) if x >= s), default=1280)
        path = await asyncio.to_thread(_thumb, row, size)
    media = "image/webp" if path.suffix == ".webp" and path.parent == THUMBS else row["mime"]
    return FileResponse(path, media_type=media, headers=IMMUTABLE)


class AssetPatch(BaseModel):
    name: str


@router.patch("/assets/{aid}")
def rename_asset(aid: str, body: AssetPatch):
    db = ctx().db
    db.x("update assets set name=? where id=?", (body.name.strip()[:80] or "image", aid))
    row = db.one("select * from assets where id=?", (aid,))
    if not row:
        raise HTTPException(404, "unknown image")
    return _asset(row)


@router.delete("/assets/{aid}")
def delete_asset(aid: str):
    db = ctx().db
    row = db.one("select * from assets where id=?", (aid,))
    if not row:
        return {"ok": True}
    db.x("delete from assets where id=?", (aid,))
    for path in [ASSETS / row["file"], *THUMBS.glob(f"{aid}_*")] if THUMBS.exists() else [ASSETS / row["file"]]:
        try:
            path.unlink()
        except OSError:
            pass
    return {"ok": True}


@router.get("/fetch")
async def fetch_info():
    c = ctx()

    def run():
        import datetime as dt

        from ...engine import daily as D
        from ...engine import home as H
        from ..state import STATE
        db = c.db
        week = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")
        today = D.today()
        done = bool((D._load(db, today).get("challenge") or {}).get("done"))
        mood = H.mood(c, STATE.corpus) if STATE.corpus is not None else None
        return {
            "user": (db.meta("spotify_user", {}) or {}).get("name") or "you",
            "host": "karasu",
            "library": db.one("select count(*) from saved")[0],
            "artists": db.one("select count(distinct norm) from sp_artists")[0],
            "analyzed": db.one("select count(*) from embeddings")[0],
            "discovered": db.one("select count(distinct dz_id) from recs")[0],
            "kept": db.one("select count(*) from recs where outcome in ('saved', 'replayed')")[0],
            "plays_week": db.one("select count(*) from listen_events where played_at >= ?", (week,))[0],
            "genres": (mood or {}).get("genres", []),
            "moods": (mood or {}).get("moods", []),
            "streak": D._streak(db, today, done),
            "since": (db.one("select min(added_at) from recs")[0] or "")[:10] or None,
        }

    from ..state import STATE
    return await asyncio.to_thread(lambda: STATE.memo("fetch", 60, run))


def _ink_alpha(rgba, mode):
    from PIL import Image, ImageChops, ImageOps
    paper = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    gray = ImageOps.grayscale(Image.alpha_composite(paper, rgba))
    ink = ImageOps.invert(gray) if mode in ("dark", "solid") else gray
    ink = ImageOps.autocontrast(ink, cutoff=1)
    if mode == "solid":
        ink = ink.point(lambda v: 255 if v > 90 else 0)
    return ImageChops.multiply(ink, rgba.getchannel("A"))


def _first_frame(row):
    from PIL import Image
    with Image.open(ASSETS / row["file"]) as img:
        img.seek(0)
        return img.convert("RGBA")


def _mask(row, mode, size):
    THUMBS.mkdir(parents=True, exist_ok=True)
    out = THUMBS / f"{row['id']}_mask_{mode}_{size}.webp"
    if out.exists():
        return out
    from PIL import Image
    rgba = _first_frame(row)
    rgba.thumbnail((size, size), Image.LANCZOS)
    result = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    result.putalpha(_ink_alpha(rgba, mode))
    return _replace(out, lambda tmp: result.save(tmp, "WEBP", lossless=True))


def _unsupported(row):
    return not row or row["mime"] == "image/svg+xml" or row["mime"].startswith("video/")


@router.get("/assets/{aid}/mask")
async def get_mask(aid: str, mode: str = "dark", s: int = 640):
    if mode not in ("dark", "light", "solid"):
        raise HTTPException(400, "unknown mask mode")
    row = ctx().db.one("select * from assets where id=?", (aid,))
    if _unsupported(row):
        raise HTTPException(404, "unknown image")
    size = min((x for x in (160, 320, 640, 1280) if x >= s), default=1280)
    path = await asyncio.to_thread(_mask, row, mode, size)
    return FileResponse(path, media_type="image/webp", headers=IMMUTABLE)


def _cursor(row, size, mode, color):
    THUMBS.mkdir(parents=True, exist_ok=True)
    out = THUMBS / f"{row['id']}_cursor_{mode}_{color if mode != 'original' else 'x'}_{size}.png"
    if out.exists():
        return out
    from PIL import Image, ImageOps
    rgba = ImageOps.contain(_first_frame(row), (size, size), Image.LANCZOS)
    if mode != "original":
        alpha = _ink_alpha(rgba, mode)
        rgba = Image.new("RGBA", rgba.size, (*bytes.fromhex(color), 255))
        rgba.putalpha(alpha)
    return _replace(out, lambda tmp: rgba.save(tmp, "PNG"))


@router.get("/assets/{aid}/cursor")
async def get_cursor(aid: str, s: int = 32, mode: str = "original", color: str = "ecebe6"):
    if mode not in ("original", "dark", "light", "solid"):
        raise HTTPException(400, "unknown cursor mode")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", color):
        raise HTTPException(400, "color must be six hex digits")
    row = ctx().db.one("select * from assets where id=?", (aid,))
    if _unsupported(row):
        raise HTTPException(404, "pick a picture for the cursor")
    path = await asyncio.to_thread(_cursor, row, max(8, min(256, s)), mode, color.lower())
    return FileResponse(path, media_type="image/png", headers=IMMUTABLE)
