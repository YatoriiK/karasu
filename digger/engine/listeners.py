import atexit
import base64
import json
import os
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

from websockets.exceptions import WebSocketException
from websockets.sync.client import connect

from .. import CACHE
from ..net import NetError
from ..sources.spotify import AuthError
from ..sync import _store_track
from ..util import norm_artist, now, now_iso, parse_iso
from .catalog import parse_id
from .home import artist_ids_by_name
from .spotify_lib import image_art

PAGE = "https://open.spotify.com/artist/{}"
SETTING = "listeners.enabled"
GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
FRESH = 7 * 86400
RETRY = 3600
IDLE = 90
WAIT = 1.2
BROWSERS = [
    ("PROGRAMFILES", r"Google\Chrome\Application\chrome.exe"),
    ("PROGRAMFILES(X86)", r"Google\Chrome\Application\chrome.exe"),
    ("LOCALAPPDATA", r"Google\Chrome\Application\chrome.exe"),
    ("PROGRAMFILES(X86)", r"Microsoft\Edge\Application\msedge.exe"),
    ("PROGRAMFILES", r"Microsoft\Edge\Application\msedge.exe"),
    ("PROGRAMFILES", r"BraveSoftware\Brave-Browser\Application\brave.exe"),
]


class PageError(Exception):
    pass


def find_browser():
    for env, rel in BROWSERS:
        base = os.environ.get(env)
        if base and (Path(base) / rel).is_file():
            return str(Path(base) / rel)
    try:
        import winreg
    except ImportError:
        return shutil.which("chrome") or shutil.which("msedge")
    for exe in ("chrome.exe", "msedge.exe"):
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}") as key:
                    path = (winreg.QueryValue(key, None) or "").strip('"')
            except OSError:
                continue
            if path and Path(path).is_file():
                return path
    return shutil.which("chrome") or shutil.which("msedge")


class Headless:
    def __init__(self, profile):
        self.profile = Path(profile)
        self.proc = None
        self.ws = None
        self.seq = 0
        self.inbox = deque()
        self.lock = threading.Lock()
        self.used = 0.0
        self.timer = None

    def alive(self):
        return self.ws is not None and (self.proc is None or self.proc.poll() is None)

    def _attach(self):
        try:
            port, path = (self.profile / "DevToolsActivePort").read_text().split()[:2]
            self.ws = connect(f"ws://127.0.0.1:{port}{path}", max_size=None, open_timeout=3)
        except (OSError, ValueError, TimeoutError, WebSocketException):
            self.ws = None
            return False
        return True

    def start(self):
        if self._attach():
            return
        exe = find_browser()
        if not exe:
            raise PageError("Karasu needs Google Chrome or Microsoft Edge to read Spotify's artist pages")
        self.profile.mkdir(parents=True, exist_ok=True)
        (self.profile / "DevToolsActivePort").unlink(missing_ok=True)
        self.proc = subprocess.Popen(
            [exe, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={self.profile}", "--no-first-run",
             "--no-default-browser-check", "--disable-extensions", "--mute-audio", "about:blank"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.time() + 20
        while time.time() < deadline and self.proc.poll() is None:
            if self._attach():
                return
            time.sleep(0.15)
        self.stop()
        raise PageError("the headless browser didn't start")

    def stop(self):
        ws, proc = self.ws, self.proc
        self.ws = self.proc = None
        self.inbox.clear()
        if ws:
            try:
                ws.send(json.dumps({"id": 0, "method": "Browser.close"}))
                ws.close()
            except (OSError, WebSocketException):
                pass
        if proc and proc.poll() is None:
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()

    def call(self, method, params=None, session=None, timeout=15):
        self.seq += 1
        mid = self.seq
        message = {"id": mid, "method": method, "params": params or {}}
        if session:
            message["sessionId"] = session
        self.ws.send(json.dumps(message))
        deadline = time.time() + timeout
        while True:
            left = deadline - time.time()
            if left <= 0:
                raise PageError(f"{method} timed out")
            try:
                reply = json.loads(self.ws.recv(timeout=left))
            except TimeoutError:
                raise PageError(f"{method} timed out") from None
            if reply.get("id") == mid:
                if "error" in reply:
                    raise PageError(reply["error"].get("message") or method)
                return reply.get("result") or {}
            self.inbox.append(reply)

    def _next(self, deadline):
        if self.inbox:
            return self.inbox.popleft()
        left = deadline - time.time()
        if left <= 0:
            raise TimeoutError
        return json.loads(self.ws.recv(timeout=left))

    def capture(self, url, pick, timeout=30):
        with self.lock:
            try:
                for attempt in range(2):
                    try:
                        if not self.alive():
                            self.stop()
                            self.start()
                        return self._capture(url, pick, timeout)
                    except (OSError, WebSocketException) as exc:
                        self.stop()
                        if attempt:
                            raise PageError(str(exc) or "the headless browser stopped") from exc
            finally:
                self.used = time.time()
                self._arm()

    def _capture(self, url, pick, timeout):
        target = self.call("Target.createTarget", {"url": "about:blank"})["targetId"]
        try:
            session = self.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
            self.call("Network.enable", session=session)
            self.call("Page.navigate", {"url": url}, session=session)
            watching = set()
            deadline = time.time() + timeout
            while True:
                try:
                    message = self._next(deadline)
                except TimeoutError:
                    raise PageError("Spotify's page didn't send the artist's stats") from None
                if message.get("sessionId") != session:
                    continue
                params = message.get("params") or {}
                method = message.get("method")
                if method == "Network.responseReceived":
                    if "/pathfinder/" in ((params.get("response") or {}).get("url") or ""):
                        watching.add(params.get("requestId"))
                elif method == "Network.loadingFinished" and params.get("requestId") in watching:
                    try:
                        body = self.call("Network.getResponseBody", {"requestId": params["requestId"]}, session=session)
                    except PageError:
                        continue
                    text = body.get("body") or ""
                    if body.get("base64Encoded"):
                        text = base64.b64decode(text).decode("utf-8", "replace")
                    found = pick(text)
                    if found is not None:
                        return found
        finally:
            try:
                self.call("Target.closeTarget", {"targetId": target}, timeout=5)
            except PageError:
                pass
            self.inbox.clear()

    def _arm(self):
        if self.timer:
            self.timer.cancel()
        self.timer = threading.Timer(IDLE, self._idle)
        self.timer.daemon = True
        self.timer.start()

    def _idle(self):
        if not self.lock.acquire(blocking=False):
            return
        try:
            if time.time() - self.used >= IDLE - 1:
                self.stop()
        finally:
            self.lock.release()


BROWSER = Headless(CACHE / "spotify-pages")
atexit.register(BROWSER.stop)


def overview(text, sp_id):
    try:
        data = json.loads(text)
    except ValueError:
        return None
    union = (data.get("data") or {}).get("artistUnion") if isinstance(data, dict) else None
    if not isinstance(union, dict) or not isinstance(union.get("stats"), dict):
        return None
    if union.get("id") != sp_id and union.get("uri") != f"spotify:artist:{sp_id}":
        return None
    stats = union["stats"]
    sources = ((union.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
    image = max(sources, key=lambda s: s.get("width") or 0).get("url") if sources else None
    cities = [{"city": c["city"], "country": c.get("country"), "region": c.get("region"),
               "listeners": int(c.get("numberOfListeners") or 0)}
              for c in (stats.get("topCities") or {}).get("items") or [] if c.get("city")]
    return {"name": (union.get("profile") or {}).get("name"), "monthly": stats.get("monthlyListeners"),
            "followers": stats.get("followers"), "world_rank": stats.get("worldRank") or None, "image": image,
            "cities": cities}


def geocode(ctx, city, country):
    try:
        data = ctx.net.request("GET", GEOCODE, params={"name": city, "count": 10, "language": "en", "format": "json",
                                                         "countryCode": country}, ttl=365 * 86400, miss_ttl=30 * 86400)
    except NetError:
        return None
    hits = [r for r in (data or {}).get("results") or []
            if (r.get("country_code") or "").upper() == (country or "").upper() and r.get("latitude") is not None]
    if not hits:
        return None
    best = max(hits, key=lambda r: r.get("population") or 0)
    return round(best["latitude"], 4), round(best["longitude"], 4)


def _failed(ctx, sp_id, error):
    ctx.db.x("insert into artist_listeners(sp_id, status, error, fetched_at) values(?, 'error', ?, ?) "
             "on conflict(sp_id) do update set status='error', error=excluded.error, fetched_at=excluded.fetched_at",
             (sp_id, error, now_iso()))


def fetch(ctx, sp_id):
    try:
        data = BROWSER.capture(PAGE.format(sp_id), lambda text: overview(text, sp_id))
    except PageError as exc:
        _failed(ctx, sp_id, str(exc))
        return
    for city in data["cities"]:
        point = geocode(ctx, city["city"], city["country"])
        if point:
            city["lat"], city["lon"] = point
    ctx.db.x("insert or replace into artist_listeners(sp_id, name, monthly, followers, world_rank, cities, image, status, "
             "error, fetched_at) values(?,?,?,?,?,?,?, 'ok', null, ?)",
             (sp_id, data["name"], data["monthly"], data["followers"], data["world_rank"], json.dumps(data["cities"]),
              data["image"], now_iso()))


class Queue:
    def __init__(self):
        self.items = deque()
        self.busy = set()
        self.cond = threading.Condition()
        self.thread = None
        self.ctx = None

    def want(self, ctx, sp_id, urgent=True):
        with self.cond:
            self.ctx = ctx
            if sp_id in self.busy:
                if urgent and sp_id in self.items:
                    self.items.remove(sp_id)
                    self.items.appendleft(sp_id)
                return
            self.busy.add(sp_id)
            if urgent:
                self.items.appendleft(sp_id)
            else:
                self.items.append(sp_id)
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, daemon=True, name="listeners")
                self.thread.start()
            self.cond.notify_all()

    def wait(self, sp_id, timeout):
        deadline = time.time() + timeout
        with self.cond:
            while sp_id in self.busy:
                left = deadline - time.time()
                if left <= 0:
                    return False
                self.cond.wait(left)
        return True

    def _run(self):
        while True:
            with self.cond:
                while not self.items:
                    self.cond.wait()
                sp_id = self.items.popleft()
                ctx = self.ctx
            try:
                fetch(ctx, sp_id)
            except Exception as exc:
                ctx.log(f"listeners: {sp_id} failed: {exc!r}")
                _failed(ctx, sp_id, "Couldn't read Spotify's page")
            finally:
                with self.cond:
                    self.busy.discard(sp_id)
                    self.cond.notify_all()


QUEUE = Queue()


def _row(db, sp_id):
    row = db.one("select * from artist_listeners where sp_id=?", (sp_id,))
    return dict(row) if row else None


def _age(row):
    stamp = parse_iso(row.get("fetched_at")) if row else None
    return (now() - stamp).total_seconds() if stamp else None


def _fresh(row):
    age = _age(row)
    return age is not None and age < (FRESH if row.get("status") == "ok" else RETRY)


def artist_by_name(ctx, name):
    norm = norm_artist(name)
    row = ctx.db.one(
        "select a.id, a.name, coalesce((select sum(weight) from seeds where ref = a.id and kind like 'artist:%'), 0) w, "
        "(select count(*) from sp_tracks t where t.artist_ids like '%\"' || a.id || '\"%') n "
        "from sp_artists a where a.norm=? order by w desc, n desc limit 1", (norm,))
    if row:
        return {"sp_id": row["id"], "name": row["name"]}
    try:
        items = [a for a in ctx.sp.search_artists(name) if a and a.get("id")]
    except (NetError, AuthError):
        return None
    exact = [a for a in items if norm_artist(a.get("name")) == norm]
    pick = (exact or items or [None])[0]
    return {"sp_id": pick["id"], "name": pick.get("name")} if pick else None


def _track_credits(ctx, track_id):
    db = ctx.db
    kind, value = parse_id(track_id)
    sp_id = value if kind == "sp" else None
    if kind == "dz":
        row = db.one("select sp_id from sp_dz where dz_id=? union all "
                     "select sp_id from dz_sp where dz_id=? and coalesce(sp_id, '') != '' limit 1", (value, value))
        sp_id = row["sp_id"] if row else None
    if sp_id:
        row = db.one("select name, artists, artist_ids from sp_tracks where id=?", (sp_id,))
        if row is None:
            try:
                with db.tx():
                    _store_track(db, ctx.sp.track(sp_id))
            except (NetError, AuthError):
                pass
            row = db.one("select name, artists, artist_ids from sp_tracks where id=?", (sp_id,))
        if row and row["artist_ids"]:
            pairs = zip(json.loads(row["artist_ids"]), json.loads(row["artists"] or "[]"))
            credits = [{"sp_id": i, "name": n} for i, n in pairs if i]
            if credits:
                return row["name"], credits
    if kind == "dz":
        row = db.one("select title, artist from dz_tracks where id=?", (value,))
        if row:
            found = artist_by_name(ctx, row["artist"])
            return row["title"], [found] if found else []
    return None, []


def resolve(ctx, name=None, sp_id=None, track=None):
    if track:
        title, credits = _track_credits(ctx, track)
        return (credits[0] if credits else None), credits, title
    if sp_id:
        row = ctx.db.one("select name from sp_artists where id=?", (sp_id,))
        return {"sp_id": sp_id, "name": row["name"] if row else name}, [], None
    return (artist_by_name(ctx, name) if name else None), [], None


def payload(ctx, artist, credits, title, row, status):
    name = (row or {}).get("name") or artist.get("name")
    dz_id = artist_ids_by_name(ctx.db, [name]).get(name) if name else None
    art = image_art((row or {}).get("image"))
    return {
        "status": status,
        "artist": {"sp_id": artist["sp_id"], "name": name, "dz_id": dz_id, "art": art[0] if art else None},
        "credits": credits,
        "track": title,
        "monthly": (row or {}).get("monthly"),
        "followers": (row or {}).get("followers"),
        "world_rank": (row or {}).get("world_rank"),
        "cities": json.loads(row["cities"]) if row and row.get("cities") else [],
        "fetched_at": (row or {}).get("fetched_at"),
        "error": (row or {}).get("error") if status == "error" else None,
    }


def enabled(db):
    value = db.settings().get(SETTING)
    if value is not None:
        return json.loads(value) is True
    return db.one("select 1 from artist_listeners limit 1") is not None


def set_enabled(db, on):
    db.set_setting(SETTING, bool(on))


def _empty(status, name, title):
    return {"status": status, "artist": {"sp_id": None, "name": name, "dz_id": None, "art": None},
            "credits": [], "track": title, "monthly": None, "followers": None, "world_rank": None, "cities": [],
            "fetched_at": None, "error": None}


def lookup(ctx, name=None, sp_id=None, track=None, wait=WAIT, retry=False):
    if not enabled(ctx.db):
        return _empty("off", name, None)
    artist, credits, title = resolve(ctx, name, sp_id, track)
    if not artist:
        return _empty("missing", name, title)
    row = _row(ctx.db, artist["sp_id"])
    if not _fresh(row) or (retry and row and row.get("status") == "error"):
        QUEUE.want(ctx, artist["sp_id"])
        if row is None or row.get("status") != "ok":
            QUEUE.wait(artist["sp_id"], wait)
            row = _row(ctx.db, artist["sp_id"])
    if artist["sp_id"] in QUEUE.busy and (row is None or row.get("status") != "ok"):
        return payload(ctx, artist, credits, title, row, "pending")
    if row is None:
        return payload(ctx, artist, credits, title, row, "pending")
    return payload(ctx, artist, credits, title, row, row.get("status") or "error")


def prefetch(ctx, names):
    if not enabled(ctx.db):
        return {"queued": 0}
    queued = 0
    for name in names:
        artist = artist_by_name(ctx, name)
        if artist and not _fresh(_row(ctx.db, artist["sp_id"])):
            QUEUE.want(ctx, artist["sp_id"], urgent=False)
            queued += 1
    return {"queued": queued}
