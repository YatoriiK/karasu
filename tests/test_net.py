import httpx
import pytest

from digger import net as netmod
from digger.net import Net, QuotaExceeded, inspect


def resp(status=200, payload=None, headers=None):
    return httpx.Response(status, json=payload, headers=headers or {})


def test_deezer_errors_arrive_as_200():
    assert inspect("api.deezer.com", resp(200, {"error": {"code": 4, "message": "Quota limit exceeded"}})) == ("retry", 5.0)
    assert inspect("api.deezer.com", resp(200, {"error": {"code": 800, "message": "no data"}})) == ("missing", None)
    assert inspect("api.deezer.com", resp(200, {"id": 1}))[0] == "ok"


def test_lastfm_errors():
    assert inspect("ws.audioscrobbler.com", resp(200, {"error": 29, "message": "Rate Limit Exceeded"})) == ("retry", 10.0)
    assert inspect("ws.audioscrobbler.com", resp(400, {"error": 6, "message": "not found"})) == ("missing", None)


def test_musicbrainz_503_and_spotify_429():
    assert inspect("musicbrainz.org", resp(503, {})) == ("retry", 2.0)
    quota = resp(429, {"error": {"status": 429, "message": "Too many requests", "reason": "QUOTA_EXCEEDED"}})
    assert inspect("api.spotify.com", quota)[0] == "quota"
    assert inspect("api.spotify.com", resp(429, {}, {"Retry-After": "3"})) == ("retry", 3.5)
    assert inspect("api.spotify.com", resp(429, {}, {"Retry-After": "3600"}))[0] == "quota"
    assert inspect("api.spotify.com", resp(404, {}))[0] == "missing"
    assert inspect("api.spotify.com", resp(400, {"error": {"message": "bad"}}))[0] == "error"


def test_spotify_player_commands_answer_with_plain_text():
    assert inspect("api.spotify.com", httpx.Response(200, text="bR8Bin-jyn_FnSB_k0Q-LdV6Wzo")) == ("ok", {})
    assert inspect("api.spotify.com", httpx.Response(202)) == ("ok", {})
    assert inspect("api.deezer.com", httpx.Response(200, text="<html>maintenance</html>"))[0] == "error"


@pytest.fixture
def fast(monkeypatch):
    monkeypatch.setattr(netmod.time, "sleep", lambda s: None)


def make_net(tmp_path, handler):
    n = Net("test", cache_path=tmp_path / "cache.db")
    n.client = httpx.Client(transport=httpx.MockTransport(handler))
    return n


def test_retry_then_cache(tmp_path, fast):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        if len(calls) == 1:
            return httpx.Response(200, json={"error": {"code": 4}})
        return httpx.Response(200, json={"id": 7})

    n = make_net(tmp_path, handler)
    assert n.get("https://api.deezer.com/track/7", ttl=60) == {"id": 7}
    assert n.get("https://api.deezer.com/track/7", ttl=60) == {"id": 7}
    assert len(calls) == 2


def test_missing_is_cached_and_quota_disables_host(tmp_path, fast):
    calls = []

    def handler(request):
        calls.append(request.url.host)
        if request.url.host == "api.deezer.com":
            return httpx.Response(200, json={"error": {"code": 800}})
        return httpx.Response(429, json={"error": {"reason": "QUOTA_EXCEEDED"}})

    n = make_net(tmp_path, handler)
    assert n.get("https://api.deezer.com/track/1", ttl=60) is None
    assert n.get("https://api.deezer.com/track/1", ttl=60) is None
    assert calls.count("api.deezer.com") == 1
    with pytest.raises(QuotaExceeded):
        n.get("https://api.spotify.com/v1/search", params={"q": "x"})
    with pytest.raises(QuotaExceeded):
        n.get("https://api.spotify.com/v1/search", params={"q": "y"})
    assert calls.count("api.spotify.com") == 1


def test_cache_prune(tmp_path):
    n = Net("test", cache_path=tmp_path / "cache.db")
    for i in range(50):
        n.cache.put(f"k{i}", "ws.audioscrobbler.com", 200, b"x" * 1000, 3600)
    assert n.cache.host_bytes("ws.audioscrobbler.com") == 50000
    n.cache.prune_host("ws.audioscrobbler.com", 20000)
    assert n.cache.host_bytes("ws.audioscrobbler.com") <= 20000
