import io

import pytest
from fastapi import HTTPException
from PIL import Image

from digger.web.routers import workspace as W
from digger.web.state import STATE


@pytest.fixture
def state(ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(W, "ASSETS", tmp_path / "assets")
    monkeypatch.setattr(W, "THUMBS", tmp_path / "assets" / "thumbs")
    previous = STATE.ctx
    STATE.ctx = ctx
    yield ctx
    STATE.ctx = previous


def png(w=400, h=300, color=(20, 20, 20)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def test_default_layout_is_created_once(state):
    first = W.list_layouts()
    assert len(first["layouts"]) == 1
    layout = first["layouts"][0]
    assert first["active"] == layout["id"]
    kinds = {i["kind"] for i in layout["data"]["items"]}
    assert {"clock", "nowplaying", "visualizer", "search"} <= kinds
    for i in layout["data"]["items"]:
        assert 0 <= i["x"] and i["x"] + i["w"] <= layout["data"]["canvas"]["w"]
        assert 0 <= i["y"] and i["y"] + i["h"] <= layout["data"]["canvas"]["h"]
    assert len(W.list_layouts()["layouts"]) == 1


def test_layout_create_update_activate_delete(state):
    base = W.list_layouts()["layouts"][0]
    made = W.create_layout(W.LayoutBody(name="  Night desk  ", data={"items": [], "canvas": {"w": 800, "h": 600}}))
    assert made["name"] == "Night desk"
    assert W.list_layouts()["active"] == made["id"]
    updated = W.update_layout(made["id"], W.LayoutBody(data={"items": [{"id": "a"}]}))
    assert updated["data"]["items"] == [{"id": "a"}] and updated["name"] == "Night desk"
    W.activate_layout(base["id"])
    assert W.list_layouts()["active"] == base["id"]
    W.delete_layout(made["id"])
    with pytest.raises(HTTPException):
        W.delete_layout(base["id"])


def test_assets_dedupe_thumbnail_and_delete(state):
    data = png(1600, 900)
    a = W.store_asset(state.db, data, r"C:\pics\clouds.png", "image/png")
    b = W.store_asset(state.db, data, "copy.png", "image/png")
    assert a["id"] == b["id"] and a["w"] == 1600 and a["h"] == 900 and a["name"] == "clouds.png"
    assert len(W.list_assets()) == 1
    row = state.db.one("select * from assets where id=?", (a["id"],))
    thumb = W._thumb(row, 320)
    with Image.open(thumb) as img:
        assert max(img.size) == 320
    with pytest.raises(HTTPException):
        W.store_asset(state.db, b"not an image", "x.png", "image/png")
    W.delete_asset(a["id"])
    assert W.list_assets() == []
    assert not (W.ASSETS / row["file"]).exists()


def test_ink_mask_turns_dark_strokes_into_alpha(state):
    img = Image.new("RGB", (200, 100), (255, 255, 255))
    for x in range(60, 140):
        for y in range(30, 70):
            img.putpixel((x, y), (10, 10, 10))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    asset = W.store_asset(state.db, buf.getvalue(), "stroke.png", "image/png")
    row = state.db.one("select * from assets where id=?", (asset["id"],))
    with Image.open(W._mask(row, "dark", 160)) as m:
        a = m.getchannel("A")
        assert a.getpixel((80, 40)) > 230
        assert a.getpixel((5, 5)) < 20
    with Image.open(W._mask(row, "light", 160)) as m:
        a = m.getchannel("A")
        assert a.getpixel((80, 40)) < 20
        assert a.getpixel((5, 5)) > 230


def gif(frames=6, w=640, h=360, duration=80):
    shots = []
    for i in range(frames):
        im = Image.new("RGB", (w, h), (255, 255, 255))
        for x in range(i * 40, i * 40 + 60):
            for y in range(100, 160):
                im.putpixel((x % w, y), (0, 0, 0))
        shots.append(im)
    buf = io.BytesIO()
    shots[0].save(buf, "GIF", save_all=True, append_images=shots[1:], duration=duration, loop=0)
    return buf.getvalue()


def test_gif_is_marked_animated_and_gets_an_animated_thumbnail(state):
    asset = W.store_asset(state.db, gif(), "loop.gif", "image/gif")
    assert asset["mime"] == "image/gif" and asset["frames"] == 6 and asset["animated"] and not asset["video"]
    row = state.db.one("select * from assets where id=?", (asset["id"],))
    with Image.open(W._thumb(row, 160)) as thumb:
        assert thumb.format == "WEBP" and getattr(thumb, "n_frames", 1) == 6 and max(thumb.size) == 160
    assert W._thumb(row, 640) == W.ASSETS / row["file"]


def test_long_gif_thumbnail_keeps_its_timing(state):
    asset = W.store_asset(state.db, gif(frames=20, w=400, h=200, duration=50), "long.gif", "image/gif")
    row = state.db.one("select * from assets where id=?", (asset["id"],))
    W.THUMBS.mkdir(parents=True, exist_ok=True)
    out = W.THUMBS / "long.webp"
    with Image.open(W.ASSETS / row["file"]) as img:
        W._animated_webp(img, out, 160, limit=8)
    with Image.open(out) as thumb:
        assert thumb.n_frames <= 8
        total = 0
        for i in range(thumb.n_frames):
            thumb.seek(i)
            thumb.load()
            total += thumb.info["duration"]
    assert total == 20 * 50


def test_videos_are_stored_with_reported_size(state):
    mp4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00" * 64
    asset = W.store_asset(state.db, mp4, "rain.mp4", "video/mp4", 1920, 1080)
    assert asset["mime"] == "video/mp4" and asset["video"] and asset["frames"] == 0
    assert (asset["w"], asset["h"]) == (1920, 1080)
    assert W._asset(state.db.one("select * from assets where id=?", (asset["id"],)))["url"].endswith(asset["id"])
    webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
    assert W.store_asset(state.db, webm, "loop.webm", "video/webm", 99999, None)["w"] is None
    with pytest.raises(HTTPException):
        W.store_asset(state.db, b"\x00\x00\x00\x18ftypqt  " + b"\x00" * 64, "clip.mov", "video/quicktime")


def test_frames_are_backfilled_for_old_rows(state):
    asset = W.store_asset(state.db, gif(frames=3), "old.gif", "image/gif")
    state.db.x("update assets set frames=null where id=?", (asset["id"],))
    listed = {a["id"]: a for a in W.list_assets()}
    assert listed[asset["id"]]["frames"] == 3 and listed[asset["id"]]["animated"]


def test_cursor_png_is_resized_and_tinted(state):
    img = Image.new("RGBA", (100, 50), (255, 255, 255, 0))
    for x in range(10, 90):
        for y in range(10, 40):
            img.putpixel((x, y), (0, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    asset = W.store_asset(state.db, buf.getvalue(), "arrow.png", "image/png")
    row = state.db.one("select * from assets where id=?", (asset["id"],))
    with Image.open(W._cursor(row, 32, "original", "x")) as cur:
        assert cur.size == (32, 16)
    with Image.open(W._cursor(row, 64, "dark", "ff0000")) as cur:
        assert cur.size == (64, 32)
        r, g, b, a = cur.getpixel((32, 16))
        assert (r, g, b) == (255, 0, 0) and a > 200
        assert cur.getpixel((1, 1))[3] < 20
