import collections
import hashlib
import json
import random
import sqlite3
import threading
import time
from urllib.parse import urlsplit

import httpx

from . import DATA

INTERVALS = {
    "api.deezer.com": 0.115,
    "ws.audioscrobbler.com": 0.26,
    "musicbrainz.org": 1.05,
    "api.discogs.com": 1.05,
    "api.spotify.com": 0.1,
    "accounts.spotify.com": 0.25,
    "api.listenbrainz.org": 1.05,
    "labs.api.listenbrainz.org": 1.05,
    "lrclib.net": 1.0,
    "www.wikidata.org": 0.5,
    "geocoding-api.open-meteo.com": 0.25,
}
DEFAULT_INTERVAL = 0.02
LASTFM_HOST = "ws.audioscrobbler.com"


class NetError(Exception):
    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


class QuotaExceeded(NetError):
    pass


class _Limiter:
    def __init__(self, interval):
        self.interval = interval
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            delay = self.next_at - now
            self.next_at = max(now, self.next_at) + self.interval
        if delay > 0:
            time.sleep(delay)

    def pause(self, seconds):
        with self.lock:
            self.next_at = max(self.next_at, time.monotonic() + seconds)


class Cache:
    def __init__(self, path):
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=30)
        self.lock = threading.Lock()
        self.conn.execute("pragma journal_mode=wal")
        self.conn.execute("pragma synchronous=normal")
        self.conn.execute(
            "create table if not exists cache(k text primary key, host text, status int, body blob, "
            "stored real, expires real, size int)")
        self.conn.execute("create index if not exists cache_host on cache(host, stored)")

    def get(self, key):
        with self.lock:
            row = self.conn.execute("select status, body, expires from cache where k=?", (key,)).fetchone()
        if not row or row[2] < time.time():
            return None
        return row[0], row[1]

    def put(self, key, host, status, body, ttl):
        now = time.time()
        with self.lock:
            self.conn.execute(
                "insert or replace into cache(k, host, status, body, stored, expires, size) values(?,?,?,?,?,?,?)",
                (key, host, status, body, now, now + ttl, len(body)))

    def host_bytes(self, host):
        with self.lock:
            return self.conn.execute("select coalesce(sum(size), 0) from cache where host=?", (host,)).fetchone()[0]

    def prune_host(self, host, max_bytes):
        total = self.host_bytes(host)
        if total <= max_bytes:
            return 0
        removed = 0
        with self.lock:
            rows = self.conn.execute("select k, size from cache where host=? order by stored", (host,)).fetchall()
            doomed = []
            for key, size in rows:
                if total <= max_bytes * 0.9:
                    break
                doomed.append((key,))
                total -= size
                removed += 1
            self.conn.executemany("delete from cache where k=?", doomed)
        return removed

    def purge_expired(self):
        with self.lock:
            self.conn.execute("delete from cache where expires < ?", (time.time(),))


def _cache_key(method, url, params, body):
    pairs = params.items() if isinstance(params, dict) else (params or [])
    payload = json.dumps([method, url, sorted(pairs), body], sort_keys=True, default=str)
    return hashlib.sha1(payload.encode()).hexdigest()


class Net:
    def __init__(self, user_agent, cache_path=None):
        DATA.mkdir(parents=True, exist_ok=True)
        self.client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            follow_redirects=True,
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )
        self.cache = Cache(cache_path or DATA / "http_cache.db")
        self.limiters = {}
        self.limiter_lock = threading.Lock()
        self.stats = collections.Counter()
        self.disabled = set()

    def limiter(self, host):
        with self.limiter_lock:
            if host not in self.limiters:
                self.limiters[host] = _Limiter(INTERVALS.get(host, DEFAULT_INTERVAL))
            return self.limiters[host]

    def request(self, method, url, *, params=None, json_body=None, data=None, headers=None, ttl=0, attempts=6,
                miss_ttl=None):
        host = urlsplit(url).hostname
        if host in self.disabled:
            raise QuotaExceeded(f"{host} disabled for this run")
        key = None
        if ttl:
            key = _cache_key(method, url, params, json_body)
            hit = self.cache.get(key)
            if hit is not None:
                self.stats[f"{host}:cache"] += 1
                status, body = hit
                return None if status == 404 else json.loads(body)
        last_error = None
        for attempt in range(attempts):
            self.limiter(host).wait()
            try:
                resp = self.client.request(method, url, params=params, json=json_body, data=data, headers=headers)
            except httpx.TransportError as exc:
                last_error = exc
                time.sleep(min(30.0, 2 ** attempt + random.random()))
                continue
            self.stats[f"{host}:net"] += 1
            verdict, payload = inspect(host, resp)
            if verdict == "ok":
                if key:
                    self.cache.put(key, host, 200, json.dumps(payload).encode(), ttl)
                return payload
            if verdict == "missing":
                if key:
                    self.cache.put(key, host, 404, b"null", miss_ttl or ttl)
                return None
            if verdict == "retry":
                self.stats[f"{host}:retry"] += 1
                self.limiter(host).pause(payload)
                last_error = NetError(f"{host} asked to retry", resp.status_code, resp.text[:300])
                continue
            if verdict == "quota":
                self.disabled.add(host)
                raise QuotaExceeded(payload, resp.status_code, resp.text[:300])
            raise NetError(payload, resp.status_code, resp.text[:500])
        raise NetError(f"gave up on {host}: {last_error}", getattr(last_error, "status", None))

    def get(self, url, params=None, headers=None, ttl=0):
        return self.request("GET", url, params=params, headers=headers, ttl=ttl)

    def get_bytes(self, url, attempts=3):
        for attempt in range(attempts):
            try:
                resp = self.client.get(url, headers={"Accept": "*/*"})
            except httpx.TransportError:
                time.sleep(1 + attempt * 2)
                continue
            if resp.status_code == 200 and resp.content:
                self.stats["preview:net"] += 1
                return resp.content
            if resp.status_code in (403, 404, 410):
                return None
            time.sleep(1 + attempt * 2)
        return None

    def close(self):
        self.client.close()


def _retry_after(resp, default):
    raw = resp.headers.get("Retry-After")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def inspect(host, resp):
    status = resp.status_code
    if status == 204 or (200 <= status < 300 and not resp.content):
        return "ok", {}
    try:
        data = resp.json()
    except ValueError:
        data = None
    if status == 429:
        error = data.get("error") if isinstance(data, dict) else None
        if isinstance(error, dict) and error.get("reason") == "QUOTA_EXCEEDED":
            return "quota", f"{host} quota exceeded"
        delay = _retry_after(resp, 5.0)
        if delay > 300:
            return "quota", f"{host} rate limited for {int(delay)} s"
        return "retry", delay + 0.5
    if status in (500, 502, 503, 504):
        return "retry", _retry_after(resp, 2.0 if host == "musicbrainz.org" else 4.0)
    if host == LASTFM_HOST and isinstance(data, dict) and "error" in data:
        code = data.get("error")
        if code == 29:
            return "retry", 10.0
        if code in (8, 11, 16):
            return "retry", 5.0
        if code == 6:
            return "missing", None
        return "error", f"Last.fm error {code}: {data.get('message')}"
    if status == 404:
        return "missing", None
    if status >= 400:
        message = None
        if isinstance(data, dict):
            error = data.get("error")
            message = error.get("message") if isinstance(error, dict) else data.get("message") or error
        return "error", f"{host} HTTP {status}: {message or resp.text[:200]}"
    if host == "api.deezer.com" and isinstance(data, dict) and isinstance(data.get("error"), dict):
        code = data["error"].get("code")
        if code in (4, 700):
            return "retry", 5.0
        if code == 800:
            return "missing", None
        return "error", f"Deezer error {code}: {data['error'].get('message')}"
    if data is None:
        if host == "api.spotify.com" and 200 <= status < 300:
            return "ok", {}
        return "error", f"{host} returned non-JSON (HTTP {status})"
    return "ok", data
