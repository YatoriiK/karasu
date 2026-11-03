import io

import pytest
from PIL import Image, ImageDraw

from karasu.engine import media
from karasu.engine.media import parse_lrc
from karasu.web.routers import system
from karasu.web.state import STATE


def _jpeg(size, background, shape=None, **style):
    img = Image.new("RGB", (size, size), background)
    if shape:
        getattr(ImageDraw.Draw(img), shape)(**style)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


BLANK = _jpeg(1000, (233, 231, 238))
RING = _jpeg(1000, (233, 231, 238), "rounded_rectangle", xy=(270, 270, 730, 730), radius=170,
             outline=(196, 195, 200), width=40)
REAL = _jpeg(300, (20, 30, 40), "ellipse", xy=(50, 50, 250, 250), fill=(200, 60, 40))


class ArtNet:
    def __init__(self, blank_when):
        self.blank_when = blank_when
        self.urls = []

    def get_bytes(self, url):
        self.urls.append(url)
        return RING if self.blank_when in url else REAL


class FakeSpotify:
    def track(self, sp_id):
        return {"album": {"images": [{"url": f"https://i.scdn.co/image/ab67616d00001e02{sp_id}"}]}}


@pytest.fixture
def art(ctx, tmp_path, monkeypatch):
    monkeypatch.setattr(media, "ART", tmp_path / "art")
    monkeypatch.setattr(media, "_blank", {})
    ctx.sp = FakeSpotify()
    return ctx


def test_deezer_placeholders_are_recognized():
    assert media.is_placeholder(RING) and media.is_placeholder(BLANK)
    assert not media.is_placeholder(REAL)
    assert not media.is_placeholder(b"") and not media.is_placeholder(b"not an image")


def test_blank_deezer_cover_becomes_the_spotify_cover(art):
    art.db.x("insert into dz_tracks(id, title, artist, md5) values(1, 'Song', 'A', 'feed')")
    art.db.x("insert into dz_sp(dz_id, sp_id, checked_at) values(1, 'sp1', '2026-11-01')")
    art.net = ArtNet("dzcdn")
    assert media.ensure_source(art, "cover", "feed").read_bytes() == REAL
    assert art.net.urls[-1] == "https://i.scdn.co/image/ab67616d0000b273sp1"
    assert media.palette(art, "cover", "feed")["accent"]


def test_blank_cover_without_a_match_stays_missing_for_a_while(art):
    art.db.x("insert into dz_tracks(id, title, artist, md5) values(2, 'Song', 'A', 'beef')")
    art.db.x("insert into dz_sp(dz_id, sp_id, checked_at) values(2, null, '2026-11-01')")
    art.net = ArtNet("dzcdn")
    assert media.ensure_source(art, "cover", "beef") is None
    calls = len(art.net.urls)
    assert media.palette(art, "cover", "beef") is None
    assert len(art.net.urls) == calls
    assert art.db.one("select 1 from art_palette where key='cover:beef'") is None


def test_blank_artist_photo_uses_one_of_their_covers(art):
    art.db.x("insert into dz_artists(id, name, picture) values(7, 'A', 'face')")
    art.db.x("insert into dz_tracks(id, title, artist, artist_id, md5) values(3, 'Song', 'A', 7, 'c0ve')")
    art.net = ArtNet("images/artist")
    assert media.ensure_source(art, "artist", "face").read_bytes() == REAL


def test_cached_placeholders_are_forgotten(art):
    for kind, ref, data in (("cover", "aa", RING), ("artist", "bb", RING), ("cover", "cc", REAL)):
        path = media.source_path(kind, ref)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        media.sized_path(kind, ref, 320).parent.mkdir(parents=True, exist_ok=True)
        media.sized_path(kind, ref, 320).write_bytes(b"webp")
        art.db.x("insert into art_palette(key, palette) values(?, '{}')", (f"{kind}:{ref}",))
    assert media.forget_placeholders(art.db) == {"placeholders": 2}
    assert not media.source_path("cover", "aa").exists() and not media.sized_path("artist", "bb", 320).exists()
    assert media.source_path("cover", "cc").exists()
    assert [r[0] for r in art.db.q("select key from art_palette")] == ["cover:cc"]


def test_parse_lrc_orders_lines_and_repeats():
    text = "[ar:Someone]\n[00:12.50]Second line\n[00:01.00][01:02.25]Chorus\n\n[00:05]First words"
    lines = parse_lrc(text)
    assert [line["t"] for line in lines] == [1.0, 5.0, 12.5, 62.25]
    assert [line["text"] for line in lines] == ["Chorus", "First words", "Second line", "Chorus"]
    assert parse_lrc("") is None
    assert parse_lrc("no timestamps here") is None


@pytest.fixture
def state(ctx):
    previous = STATE.ctx
    STATE.ctx = ctx
    yield ctx
    STATE.ctx = previous


def test_reset_history_and_search(state):
    db = state.db
    for n in range(3):
        db.x("insert into listen_events(source, dz_id, artist, title, played_at, ms_played, skipped) "
             "values('app', ?, 'a', 't', ?, 1000, 0)", (n + 1, f"2026-11-01T0{n}:00:00Z"))
    db.x("insert into search_history(q, last_at, count) values('duster', '2026-11-01T00:00:00Z', 2)")
    STATE.cache["home:x"] = (0, {})
    assert system.reset_history() == {"removed": 3}
    assert db.one("select count(*) from listen_events")[0] == 0
    assert "home:x" not in STATE.cache
    assert system.clear_search_history() == {"ok": True}
    assert db.one("select count(*) from search_history")[0] == 0


def test_folder_sizes(tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"x" * 10)
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.mp3").write_bytes(b"x" * 5)
    (tmp_path / "c.txt").write_bytes(b"x" * 3)
    assert system._folder(tmp_path, "*.mp3") == {"files": 2, "bytes": 15}
    assert system._folder(tmp_path) == {"files": 3, "bytes": 18}
    assert system._folder(tmp_path / "missing") == {"files": 0, "bytes": 0}
