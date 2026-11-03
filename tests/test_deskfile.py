import io
import json
import zipfile

import pytest
from fastapi import HTTPException
from PIL import Image

from karasu.db import DB
from karasu.web.routers import deskfile as D
from karasu.web.routers import workspace as W


def png(color):
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def pcs(ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(D, "TMP", tmp_path / "tmp")
    mine = tmp_path / "mine"
    theirs = tmp_path / "theirs"
    theirs.mkdir()
    other = DB(theirs / "test.db")

    def on(which):
        monkeypatch.setattr(W, "ASSETS", (mine if which == "mine" else theirs) / "assets")
        monkeypatch.setattr(W, "THUMBS", (mine if which == "mine" else theirs) / "assets" / "thumbs")
        return ctx.db if which == "mine" else other

    yield on
    other.close()


def make_desk(db):
    wall = W.store_asset(db, png((10, 10, 40)), "night.png", "image/png")
    sticker = W.store_asset(db, png((200, 30, 30)), "crow.png", "image/png")
    W.store_asset(db, png((0, 200, 0)), "unused.png", "image/png")
    look = {"ink": "#eeeeee", "wallpaper": {"asset": wall["id"], "dim": 0.3},
            "fx": {"particles": "rain", "cursor": "image", "cursorAsset": sticker["id"], "css": "body{filter:invert(1)}"}}
    data = {"canvas": {"w": 1280, "h": 620}, "items": [
        {"id": "s1", "kind": "image", "props": {"asset": sticker["id"]}, "style": {}},
        {"id": "c1", "kind": "clock", "props": {}, "style": {"bg": "image", "bgImage": wall["id"]}},
    ], "look": look}
    lid = db.x("insert into layouts(name, data, pos, created, updated) values(?,?,?,?,?)",
               ("Rainy night", json.dumps(data), 0, "now", "now")).lastrowid
    return lid, wall["id"], sticker["id"]


def test_a_desk_travels_with_its_pictures(pcs):
    mine = pcs("mine")
    lid, wall, sticker = make_desk(mine)
    path, name = D.build(mine, lid)
    assert name == "Rainy night"
    with zipfile.ZipFile(path) as zf:
        assert sorted(n for n in zf.namelist() if n.startswith("assets/")) == sorted(
            f"assets/{a}.png" for a in (wall, sticker))

    theirs = pcs("theirs")
    found = D.inspect(path)
    assert found["summary"] == {"name": "Rainy night", "widgets": 2, "pictures": 2,
                                "bytes": path.stat().st_size, "css": True}
    made = D.commit(theirs, {"path": path, **found}, use_css=False)
    assert made["name"] == "Rainy night"
    assert made["data"]["items"][0]["props"]["asset"] == sticker
    assert made["data"]["look"]["wallpaper"]["asset"] == wall
    assert made["data"]["look"]["fx"]["particles"] == "rain"
    assert made["data"]["look"]["fx"]["css"] == ""
    assert {r["id"] for r in theirs.q("select id from assets")} == {wall, sticker}
    assert (W.ASSETS / f"{wall}.png").exists()
    assert theirs.meta("active_layout") == made["id"]
    assert made["data"]["wallpaper"] is None

    again = D.commit(theirs, {"path": path, **D.inspect(path)}, use_css=True)
    assert again["name"] == "Rainy night 2"
    assert again["data"]["look"]["fx"]["css"] == "body{filter:invert(1)}"


def test_a_desk_without_its_own_look_takes_the_current_one(pcs):
    mine = pcs("mine")
    wall = W.store_asset(mine, png((1, 2, 3)), "w.png", "image/png")
    lid = mine.x("insert into layouts(name, data, pos, created, updated) values(?,?,?,?,?)",
                 ("Plain", json.dumps({"items": []}), 0, "now", "now")).lastrowid
    path, _ = D.build(mine, lid, look={"ink": "#111111", "wallpaper": {"asset": wall["id"]}})
    found = D.inspect(path)
    assert found["look"]["ink"] == "#111111" and found["summary"]["pictures"] == 1


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w") as zf:
        for name, body in entries.items():
            zf.writestr(name, body)
    return path


def test_junk_files_are_refused_and_odd_entries_ignored(pcs, tmp_path):
    pcs("theirs")
    junk = tmp_path / "junk.karasu"
    junk.write_bytes(b"not a zip at all")
    for path in (junk,
                 write_zip(tmp_path / "empty.karasu", {"readme.txt": "hi"}),
                 write_zip(tmp_path / "other.karasu", {"desk.json": json.dumps({"format": "something", "data": {}})}),
                 write_zip(tmp_path / "broken.karasu", {"desk.json": "{nope"})):
        with pytest.raises(HTTPException):
            D.inspect(path)
    sneaky = write_zip(tmp_path / "sneaky.karasu", {
        "desk.json": json.dumps({"format": "karasu-desk", "version": 1, "name": "x", "data": {"items": []}}),
        "../escape.png": png((1, 1, 1)),
        "assets/../../escape.png": png((1, 1, 1)),
        "assets/0123456789abcdef.png": png((5, 5, 5)),
    })
    found = D.inspect(sneaky)
    assert list(found["files"].values()) == ["assets/0123456789abcdef.png"]
