import asyncio
import json
import re
import secrets
import time
import zipfile

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from ... import CACHE
from ...util import now_iso
from ..state import ctx
from . import workspace as W

router = APIRouter(prefix="/api")

FORMAT = "karasu-desk"
VERSION = 1
MAX_FILE = 1024 * 1024 * 1024
MAX_UNPACKED = 1536 * 1024 * 1024
ASSET_ID = re.compile(r"^[0-9a-f]{16}$")
ENTRY = re.compile(r"^assets/([0-9a-f]{16})\.[a-z0-9]{2,5}$")
TMP = CACHE / "tmp" / "desks"
PENDING = {}
PENDING_TTL = 30 * 60


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def _swap(value, ids):
    if isinstance(value, str):
        return ids.get(value, value)
    if isinstance(value, dict):
        return {k: _swap(v, ids) for k, v in value.items()}
    if isinstance(value, list):
        return [_swap(v, ids) for v in value]
    return value


def _safe_name(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", name or "Desk").strip()[:60] or "Desk"


class ExportBody(BaseModel):
    look: dict | None = None


def build(db, lid, look=None):
    row = db.one("select * from layouts where id=?", (lid,))
    if not row:
        raise HTTPException(404, "unknown desk")
    data = json.loads(row["data"] or "{}")
    look = data.get("look") or look
    # Asset ids are a hash of the file, so any 16-hex string that matches a stored asset is one we need.
    wanted = {s for s in _strings([data, look]) if ASSET_ID.match(s)}
    assets = [r for r in (db.one("select * from assets where id=?", (aid,)) for aid in sorted(wanted)) if r]
    manifest = {
        "format": FORMAT, "version": VERSION, "name": row["name"], "exported": now_iso(),
        "data": data, "look": look,
        "assets": [{"id": a["id"], "name": a["name"], "mime": a["mime"], "w": a["w"], "h": a["h"],
                    "file": f"assets/{a['file']}"} for a in assets],
    }
    TMP.mkdir(parents=True, exist_ok=True)
    out = TMP / f"export-{secrets.token_hex(6)}.karasu"
    with zipfile.ZipFile(out, "w") as zf:
        zf.writestr("desk.json", json.dumps(manifest, ensure_ascii=False, indent=1), compress_type=zipfile.ZIP_DEFLATED)
        for a in assets:
            path = W.ASSETS / a["file"]
            if path.exists():
                zf.write(path, f"assets/{a['file']}", compress_type=zipfile.ZIP_STORED)
    return out, _safe_name(row["name"])


@router.post("/layouts/{lid}/export")
async def export_desk(lid: int, body: ExportBody):
    db = ctx().db
    out, name = await asyncio.to_thread(build, db, lid, body.look)
    return FileResponse(out, media_type="application/zip", filename=f"{name}.karasu",
                        background=BackgroundTask(out.unlink, missing_ok=True))


def _forget_old():
    now = time.time()
    for token, item in list(PENDING.items()):
        if now - item["at"] > PENDING_TTL:
            PENDING.pop(token, None)
            item["path"].unlink(missing_ok=True)


def inspect(path):
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise HTTPException(400, "That isn't a Karasu desk file")
    with zf:
        names = set(zf.namelist())
        if "desk.json" not in names:
            raise HTTPException(400, "That isn't a Karasu desk file")
        if sum(i.file_size for i in zf.infolist()) > MAX_UNPACKED:
            raise HTTPException(413, "That desk file is too big")
        try:
            manifest = json.loads(zf.read("desk.json").decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, "That desk file is damaged")
        if manifest.get("format") != FORMAT or not isinstance(manifest.get("data"), dict):
            raise HTTPException(400, "That isn't a Karasu desk file")
        if manifest.get("version") != VERSION:
            raise HTTPException(400, "That desk was made by a different version of Karasu")
        files = {}
        for info in zf.infolist():
            match = ENTRY.match(info.filename)
            if match and info.file_size <= W.MAX_VIDEO:
                files[match.group(1)] = info.filename
    look = manifest.get("look") if isinstance(manifest.get("look"), dict) else None
    items = manifest["data"].get("items") if isinstance(manifest["data"].get("items"), list) else []
    css = ((look or {}).get("fx") or {}).get("css") or ""
    return {"manifest": manifest, "files": files, "look": look,
            "summary": {"name": str(manifest.get("name") or "Desk")[:40], "widgets": len(items),
                        "pictures": len(files), "bytes": path.stat().st_size,
                        "css": bool(isinstance(css, str) and css.strip())}}


@router.post("/layouts/import")
async def preview_import(request: Request):
    _forget_old()
    TMP.mkdir(parents=True, exist_ok=True)
    path = TMP / f"import-{secrets.token_hex(6)}.karasu"
    size = 0
    with open(path, "wb") as fh:
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_FILE:
                fh.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "Desk files can be up to 1 GB")
            fh.write(chunk)
    try:
        found = await asyncio.to_thread(inspect, path)
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    token = secrets.token_urlsafe(12)
    PENDING[token] = {"path": path, "at": time.time(), **found}
    return {"token": token, **found["summary"]}


def _unique(db, name):
    taken = {r["name"] for r in db.q("select name from layouts")}
    if name not in taken:
        return name
    n = 2
    while f"{name} {n}" in taken:
        n += 1
    return f"{name} {n}"


def commit(db, item, use_css):
    ids = {}
    manifest = item["manifest"]
    names = {a.get("id"): a for a in manifest.get("assets") or [] if isinstance(a, dict)}
    with zipfile.ZipFile(item["path"]) as zf:
        for aid, entry in item["files"].items():
            meta = names.get(aid) or {}
            w, h = meta.get("w"), meta.get("h")
            stored = W.store_asset(db, zf.read(entry), str(meta.get("name") or "image"), meta.get("mime"),
                                 w if isinstance(w, int) else None, h if isinstance(h, int) else None)
            if stored["id"] != aid:
                ids[aid] = stored["id"]
    data = _swap(manifest["data"], ids)
    look = _swap(item["look"], ids) if item["look"] else None
    if look and not use_css:
        look = {**look, "fx": {**(look.get("fx") or {}), "css": ""}}
    if look:
        data["look"] = look
        data["wallpaper"] = None
    stamp = now_iso()
    pos = (db.one("select coalesce(max(pos), -1) from layouts")[0] or 0) + 1
    name = _unique(db, _safe_name(item["summary"]["name"])[:40])
    cur = db.x("insert into layouts(name, data, pos, created, updated) values(?,?,?,?,?)",
               (name, json.dumps(data), pos, stamp, stamp))
    db.set_meta("active_layout", cur.lastrowid)
    return W._payload(db.one("select * from layouts where id=?", (cur.lastrowid,)))


@router.post("/layouts/import/{token}")
async def finish_import(token: str, css: bool = False):
    item = PENDING.pop(token, None)
    if not item:
        raise HTTPException(404, "That import expired. Pick the file again.")
    try:
        return await asyncio.to_thread(commit, ctx().db, item, css)
    finally:
        item["path"].unlink(missing_ok=True)
