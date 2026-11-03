import json

from digger.engine import listeners as LS
from digger.engine import profile as P

OVERVIEW = {
    "data": {
        "artistUnion": {
            "id": "a1",
            "uri": "spotify:artist:a1",
            "profile": {"name": "Duster"},
            "stats": {
                "followers": 1000,
                "monthlyListeners": 3500000,
                "worldRank": 0,
                "topCities": {"items": [
                    {"city": "Los Angeles", "country": "US", "numberOfListeners": 44034, "region": "CA"},
                    {"city": "London", "country": "GB", "numberOfListeners": 33179, "region": "ENG"},
                ]},
            },
            "visuals": {"avatarImage": {"sources": [
                {"url": "https://i.scdn.co/image/small", "width": 160},
                {"url": "https://i.scdn.co/image/big", "width": 640},
            ]}},
        }
    }
}
PLACES = {
    "Los Angeles": [
        {"country_code": "CL", "latitude": -37.47, "longitude": -72.35, "population": 125000},
        {"country_code": "US", "latitude": 34.0522, "longitude": -118.2437, "population": 3971883},
    ],
    "London": [
        {"country_code": "CA", "latitude": 42.98, "longitude": -81.23, "population": 346765},
        {"country_code": "GB", "latitude": 51.5085, "longitude": -0.1257, "population": 8961989},
    ],
}


class FakeNet:
    def __init__(self):
        self.calls = []

    def request(self, method, url, params=None, **kwargs):
        self.calls.append(params)
        return {"results": PLACES.get(params["name"], [])}


class FakeSp:
    def __init__(self, items=None):
        self.items = items or []
        self.searches = []

    def search_artists(self, query, limit=10, ttl=0):
        self.searches.append(query)
        return self.items


def page(url, pick, timeout=30):
    return pick(json.dumps(OVERVIEW))


def setup(ctx):
    ctx.net = FakeNet()
    ctx.sp = FakeSp()
    ctx.db.x("insert into sp_artists(id, name, norm) values('a1', 'Duster', 'duster')")
    LS.set_enabled(ctx.db, True)


def test_the_listener_map_is_off_until_turned_on(ctx, monkeypatch):
    ctx.net = FakeNet()
    ctx.sp = FakeSp()
    ctx.db.x("insert into sp_artists(id, name, norm) values('a1', 'Duster', 'duster')")
    monkeypatch.setattr(LS.BROWSER, "capture", lambda *a, **k: (_ for _ in ()).throw(AssertionError("read a page")))
    assert not LS.enabled(ctx.db)
    assert LS.lookup(ctx, name="Duster", wait=1)["status"] == "off"
    assert LS.prefetch(ctx, ["Duster"]) == {"queued": 0} and ctx.sp.searches == []
    LS.set_enabled(ctx.db, True)
    assert LS.enabled(ctx.db)
    LS.set_enabled(ctx.db, False)
    assert not LS.enabled(ctx.db)


def test_earlier_globe_users_keep_it_on(ctx):
    ctx.db.x("insert into artist_listeners(sp_id, name, status, fetched_at) values('a1', 'Duster', 'ok', '2026-11-01')")
    assert LS.enabled(ctx.db)


def test_overview_reads_the_artist_stats_and_ignores_other_artists():
    found = LS.overview(json.dumps(OVERVIEW), "a1")
    assert found["monthly"] == 3500000 and found["world_rank"] is None and found["image"].endswith("/big")
    assert [(c["city"], c["listeners"]) for c in found["cities"]] == [("Los Angeles", 44034), ("London", 33179)]
    assert LS.overview(json.dumps(OVERVIEW), "someone-else") is None
    assert LS.overview("<html>", "a1") is None
    assert LS.overview(json.dumps({"data": {"artistUnion": {"id": "a1"}}}), "a1") is None


def test_lookup_reads_the_page_once_then_serves_the_cache(ctx, monkeypatch):
    setup(ctx)
    pages = []
    monkeypatch.setattr(LS.BROWSER, "capture", lambda url, pick, timeout=30: pages.append(url) or page(url, pick))
    first = LS.lookup(ctx, name="Duster", wait=5)
    assert first["status"] == "ok" and first["monthly"] == 3500000
    assert [(c["city"], c["lat"]) for c in first["cities"]] == [("Los Angeles", 34.0522), ("London", 51.5085)]
    assert first["artist"]["art"]["ref"] == "big"
    second = LS.lookup(ctx, name="duster", wait=5)
    assert second["status"] == "ok" and pages == ["https://open.spotify.com/artist/a1"]


def test_same_name_artists_resolve_to_the_one_you_listen_to(ctx):
    ctx.sp = FakeSp([{"id": "s1", "name": "Ducktails"}, {"id": "s2", "name": "Duster"}])
    ctx.db.x("insert into sp_artists(id, name, norm) values('x1', 'Lucki', 'lucki')")
    ctx.db.x("insert into sp_artists(id, name, norm) values('x2', 'LUCKI', 'lucki')")
    ctx.db.x("insert into seeds(kind, ref, weight) values('artist:top_short_term', 'x2', 3.0)")
    assert LS.artist_by_name(ctx, "LUCKI")["sp_id"] == "x2"
    assert ctx.sp.searches == []
    assert LS.artist_by_name(ctx, "Duster")["sp_id"] == "s2"


def test_failed_reads_show_an_error_until_retried(ctx, monkeypatch):
    setup(ctx)
    calls = []

    def broken(url, pick, timeout=30):
        calls.append(url)
        raise LS.PageError("Spotify's page didn't send the artist's stats")

    monkeypatch.setattr(LS.BROWSER, "capture", broken)
    out = LS.lookup(ctx, name="Duster", wait=5)
    assert out["status"] == "error" and "stats" in out["error"]
    assert LS.lookup(ctx, name="Duster", wait=5)["status"] == "error" and len(calls) == 1
    monkeypatch.setattr(LS.BROWSER, "capture", page)
    assert LS.lookup(ctx, name="Duster", wait=5, retry=True)["status"] == "ok"


def test_songs_show_their_artists_listeners(ctx, monkeypatch):
    setup(ctx)
    ctx.db.x("insert into sp_tracks(id, name, artists, artist_ids) values('t1', 'Echo', ?, ?)",
             (json.dumps(["Duster", "Guest"]), json.dumps(["a1", "g1"])))
    monkeypatch.setattr(LS.BROWSER, "capture", page)
    out = LS.lookup(ctx, track="sp:t1", wait=5)
    assert out["status"] == "ok" and out["track"] == "Echo"
    assert [c["name"] for c in out["credits"]] == ["Duster", "Guest"] and out["artist"]["sp_id"] == "a1"


class ProfileSp:
    configured = True

    def has_login(self):
        return True

    def me(self):
        return {"id": "me", "display_name": "crow_listener", "followers": {"total": 6}, "images": [],
                "external_urls": {"spotify": "https://open.spotify.com/user/me"}}

    def top(self, kind, time_range, max_items=100):
        if kind == "artists":
            return [{"id": "a1", "name": "Duster", "images": [{"url": "https://i.scdn.co/image/abc", "width": 640}]}]
        return [{"id": "t1", "type": "track", "name": "Inside Out", "artists": [{"id": "a1", "name": "Duster"}],
                 "album": {"name": "Stratosphere", "images": []}, "duration_ms": 200000}]

    def granted_scopes(self):
        return {"user-top-read"}


def test_profile_shows_public_playlists_and_this_months_tops(ctx):
    ctx.sp = ProfileSp()
    ctx.db.set_meta("spotify_user", {"id": "me", "name": "crow_listener"})
    for pos, (pid, owner, public) in enumerate([("p1", "me", 1), ("p2", "me", 0), ("p3", "them", 1)]):
        ctx.db.x("insert into sp_playlists(id, name, owner_id, owner_name, total, public, pos) values(?,?,?,?,?,?,?)",
                 (pid, pid.upper(), owner, owner, 3, public, pos))
    out = P.user_profile(ctx)
    assert out["user"]["name"] == "crow_listener" and out["user"]["followers"] == 6 and out["online"] is True
    assert [p["sp_id"] for p in out["playlists"]] == ["p1"]
    assert out["top_artists"][0]["name"] == "Duster" and out["top_artists"][0]["art"]["ref"] == "abc"
    assert [t["title"] for t in out["top_tracks"]] == ["Inside Out"]
    assert out["following"] == {"granted": False, "available": False, "total": None, "artists": []}
