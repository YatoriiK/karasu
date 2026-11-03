import pytest

from karasu.engine import media
from karasu.engine import spotify_lib as L
from karasu.net import NetError


def track(i, name=None):
    return {"id": f"t{i}", "type": "track", "name": name or f"Song {i}", "duration_ms": 200000,
            "artists": [{"id": f"a{i}", "name": f"Artist {i}"}],
            "album": {"name": f"Album {i}", "images": [{"url": f"https://i.scdn.co/image/img{i}", "width": 640}]}}


class FakeSp:
    def __init__(self):
        self.lists = [
            {"id": "own1", "name": "Mine", "owner": {"id": "me", "display_name": "me"}, "snapshot_id": "s1",
             "items": {"total": 3}, "images": [{"url": "https://mosaic.scdn.co/640/" + "a" * 40 + "b" * 40 + "c" * 40 + "d" * 40}]},
            {"id": "follow1", "name": "Friend's mix", "owner": {"id": "friend", "display_name": "Friend"},
             "snapshot_id": "f1", "items": {"total": 2}, "images": [{"url": "https://i.scdn.co/image/abc123"}]},
            {"id": "editorial", "name": "Discover Weekly", "owner": {"id": "spotify", "display_name": "Spotify"},
             "snapshot_id": "e1", "items": {"total": 30}, "images": []},
        ]
        self.items = {"own1": [track(1), track(2), track(3)], "follow1": [track(4), track(5)]}
        self.item_calls = []
        self.saved = [track(1), track(7)]
        self.added = []
        self.removed = []

    def playlists(self):
        return self.lists

    def playlist(self, pid):
        return next((p for p in self.lists if p["id"] == pid), None)

    def playlist_items(self, pid):
        self.item_calls.append(pid)
        if pid == "editorial":
            raise NetError("forbidden", 403)
        return [{"item": t, "added_at": "2026-10-01T00:00:00Z"} for t in self.items[pid]]

    def saved_tracks(self, max_items=None):
        return [{"item": t, "added_at": "2026-10-02T00:00:00Z"} for t in self.saved]

    def add_items(self, pid, uris, position=None):
        self.added.append((pid, uris))
        self.items[pid] += [track(int(u.rsplit(":", 1)[-1][1:])) for u in uris]
        return {"snapshot_id": "s2"}

    def remove_items(self, pid, uris):
        self.removed.append((pid, uris))
        drop = {u.rsplit(":", 1)[-1] for u in uris}
        self.items[pid] = [t for t in self.items[pid] if t["id"] not in drop]
        return {"snapshot_id": "s3"}


@pytest.fixture
def spctx(ctx):
    ctx.sp = FakeSp()
    ctx.db.set_meta("spotify_user", {"id": "me", "name": "me"})
    return ctx


def test_refresh_loads_own_items_once_and_drops_unfollowed(spctx):
    out = L.refresh_playlists(spctx)
    assert out == {"playlists": 3, "loaded": 1}
    assert spctx.sp.item_calls == ["own1"]
    L.refresh_playlists(spctx)
    assert spctx.sp.item_calls == ["own1"]
    rows = L.playlist_rows(spctx)
    assert [r["name"] for r in rows] == ["Mine", "Friend's mix", "Discover Weekly"]
    assert rows[0]["editable"] and not rows[1]["editable"]
    assert len(rows[0]["art"]) == 4 and rows[1]["art"][0]["ref"] == "abc123"
    spctx.sp.lists = spctx.sp.lists[:1]
    L.refresh_playlists(spctx)
    assert [r["name"] for r in L.playlist_rows(spctx)] == ["Mine"]


def test_detail_loads_followed_on_demand_and_flags_blocked(spctx):
    L.refresh_playlists(spctx)
    friend = L.playlist_detail(spctx, "follow1")
    assert [t["title"] for t in friend["tracks"]] == ["Song 4", "Song 5"]
    assert friend["editable"] is False and friend["blocked"] is False
    editorial = L.playlist_detail(spctx, "editorial")
    assert editorial["blocked"] is True and editorial["tracks"] == []


def test_edits_reload_items(spctx):
    L.refresh_playlists(spctx)
    L.add_tracks(spctx, "own1", ["t9"])
    assert spctx.sp.added == [("own1", ["spotify:track:t9"])]
    assert [t["title"] for t in L.playlist_detail(spctx, "own1")["tracks"]][-1] == "Song 9"
    L.remove_tracks(spctx, "own1", ["t1"])
    assert "Song 1" not in [t["title"] for t in L.playlist_detail(spctx, "own1")["tracks"]]


def test_sync_liked_removes_unliked(spctx):
    spctx.db.x("insert into saved(track_id, added_at) values('gone', '2020-01-01')")
    out = L.sync_liked(spctx)
    assert out == {"liked": 2, "removed": 1}
    assert {r[0] for r in spctx.db.q("select track_id from saved")} == {"t1", "t7"}


class FakeNet:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def request(self, method, url, params=None, **kwargs):
        self.calls.append((url.rsplit("/", 1)[-1], params))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


class NetCtx:
    def __init__(self, net):
        self.net = net


SIG = {"artist": "A", "title": "Song", "album": "Album", "duration": 200}


def test_lyrics_give_up_when_lrclib_stays_busy(monkeypatch):
    monkeypatch.setattr(media, "LYRICS_PATIENCE", 0)
    busy = NetCtx(FakeNet([NetError("busy", 503)]))
    assert media.lyrics(busy, [SIG])["status"] == "busy"
    assert len(busy.net.calls) == 1


def test_lyrics_wait_out_a_busy_moment():
    net = FakeNet([NetError("busy", 503), NetError("busy", 503), {"syncedLyrics": "[00:01.00]back"}])
    assert media.lyrics(NetCtx(net), [SIG])["synced"][0]["text"] == "back"
    assert len(net.calls) == 3


def test_lyrics_do_not_retry_errors_that_waiting_wont_fix():
    net = FakeNet([NetError("bad request", 400)])
    assert media.lyrics(NetCtx(net), [SIG])["status"] == "busy"
    assert len(net.calls) == 1


def test_lyrics_retry_with_a_cleaner_title():
    found = NetCtx(FakeNet([None, None, {"plainLyrics": "la la", "syncedLyrics": "[00:01.00]la"}]))
    out = media.lyrics(found, [{**SIG, "title": "Hummer (2011 Remaster)"}])
    assert out["status"] == "ok" and out["synced"][0]["text"] == "la"
    assert found.net.calls[-1] == ("get", {"artist_name": "A", "track_name": "Hummer", "duration": 200})


def test_lyrics_search_picks_the_matching_synced_hit():
    hits = [
        {"trackName": "Song Two", "artistName": "A", "duration": 200, "syncedLyrics": "[00:01.00]wrong"},
        {"trackName": "Song", "artistName": "Someone Else", "duration": 200, "syncedLyrics": "[00:01.00]wrong"},
        {"trackName": "Song", "artistName": "A", "duration": 230, "syncedLyrics": "[00:01.00]wrong"},
        {"trackName": "song (feat. B)", "artistName": "A & B", "duration": 201, "plainLyrics": "plain"},
        {"trackName": "Song", "artistName": "A", "duration": 199, "syncedLyrics": "[00:01.00]right"},
    ]
    net = FakeNet([None, None, hits])
    out = media.lyrics(NetCtx(net), [SIG])
    assert out["synced"][0]["text"] == "right"
    assert [c[0] for c in net.calls] == ["get", "get", "search"]


def test_lyrics_keep_plain_words_while_looking_for_synced():
    net = FakeNet([{"plainLyrics": "words"}, None, [], []])
    out = media.lyrics(NetCtx(net), [SIG])
    assert out["status"] == "ok" and out["plain"] == "words" and out["synced"] is None
    assert len(net.calls) == 4


def test_lyrics_try_spotify_names_when_deezer_misses():
    net = FakeNet([None, None, {"syncedLyrics": "[00:02.00]yes"}])
    spotify = {"artist": "A", "title": "Song - From the Film", "album": "OST", "duration": 201}
    out = media.lyrics(NetCtx(net), [SIG, spotify])
    assert out["synced"][0]["text"] == "yes"
    assert net.calls[2] == ("get", {"artist_name": "A", "track_name": "Song - From the Film", "album_name": "OST",
                                    "duration": 201})


def test_lyrics_missing_after_every_lookup():
    net = FakeNet([None, None, [], []])
    assert media.lyrics(NetCtx(net), [SIG])["status"] == "missing"
    assert media.lyrics(NetCtx(FakeNet([])), [])["status"] == "missing"
