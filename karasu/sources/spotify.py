import base64
import hashlib
import json
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import keyring

from ..net import NetError
from ..util import chunks

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API = "https://api.spotify.com/v1"
SCOPE_LIST = [
    "user-read-private",
    "user-top-read",
    "user-read-recently-played",
    "user-library-read",
    "user-library-modify",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "ugc-image-upload",
]
OPTIONAL_SCOPES = ["user-follow-read"]
SCOPES = " ".join(SCOPE_LIST + OPTIONAL_SCOPES)
KEYRING_SERVICE = "Karasu"
KEYRING_USER = "spotify"
FORM = {"Content-Type": "application/x-www-form-urlencoded"}
DONE_PAGE = (
    "<!doctype html><meta charset=utf-8><title>Karasu</title>"
    "<body style=\"font:15px Segoe UI,sans-serif;background:#16181b;color:#d8dade;padding:40px\">"
    "<div style=\"border:1px solid #3a3e44;padding:20px;max-width:520px\">{}</div>"
)


class AuthError(Exception):
    pass


def entry_track(entry):
    if not isinstance(entry, dict):
        return None
    track = entry.get("item") if isinstance(entry.get("item"), dict) else entry.get("track")
    return track if isinstance(track, dict) else None


class Spotify:
    def __init__(self, net, client_id, port=8888):
        self.net = net
        self.client_id = (client_id or "").strip()
        self.port = int(port)
        self.access_token = None
        self.expires_at = 0.0
        self.auth_url = None
        self.lock = threading.Lock()

    @property
    def redirect_uri(self):
        return f"http://127.0.0.1:{self.port}/callback"

    @property
    def configured(self):
        return bool(self.client_id)

    def has_login(self):
        saved = self._saved()
        return bool(saved) and saved.get("client_id") == self.client_id

    def login(self, open_browser=True, timeout=300):
        if not self.client_id:
            raise AuthError("spotify.client_id is empty in config.toml")
        verifier = secrets.token_urlsafe(96)[:128]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        state = secrets.token_urlsafe(16)
        url = AUTH_URL + "?" + urlencode({
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "state": state,
            "scope": SCOPES,
        })
        self.auth_url = url
        result = {}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parts = urlsplit(self.path)
                if parts.path != "/callback":
                    self.send_response(404)
                    self.end_headers()
                    return
                result.update({k: v[0] for k, v in parse_qs(parts.query).items()})
                ok = "code" in result and result.get("state") == state
                text = "Karasu is connected to Spotify. You can close this tab." if ok else \
                    f"Spotify login failed: {result.get('error', 'unknown error')}"
                body = DONE_PAGE.format(text).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", self.port), Handler)
        server.timeout = 1
        print(f"Opening Spotify login. If the browser doesn't open, visit:\n{url}")
        if open_browser:
            webbrowser.open(url)
        deadline = time.time() + timeout
        try:
            while not result and time.time() < deadline:
                server.handle_request()
        finally:
            server.server_close()
        if not result:
            raise AuthError("Timed out waiting for the Spotify login")
        if result.get("state") != state:
            raise AuthError("Login state mismatch, try again")
        if "error" in result or "code" not in result:
            raise AuthError(f"Spotify refused the login: {result.get('error')}")
        token = self.net.request("POST", TOKEN_URL, headers=FORM, data={
            "grant_type": "authorization_code",
            "code": result["code"],
            "redirect_uri": self.redirect_uri,
            "client_id": self.client_id,
            "code_verifier": verifier,
        })
        self._store(token)
        return self.me()

    def _store(self, token):
        self.access_token = token["access_token"]
        self.expires_at = time.time() + float(token.get("expires_in", 3600)) - 60
        saved = self._saved() or {}
        refresh = token.get("refresh_token") or saved.get("refresh_token")
        if refresh:
            keyring.set_password(KEYRING_SERVICE, KEYRING_USER, json.dumps({
                "refresh_token": refresh,
                "client_id": self.client_id,
                "scope": token.get("scope") or saved.get("scope", ""),
            }))

    def _saved(self):
        try:
            raw = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
        except Exception:
            return None
        return json.loads(raw) if raw else None

    def granted_scopes(self):
        saved = self._saved() or {}
        return set((saved.get("scope") or "").split())

    def missing_scopes(self):
        granted = self.granted_scopes()
        if not granted:
            return ["user-read-playback-state", "user-modify-playback-state", "user-library-modify", "ugc-image-upload"]
        return [s for s in SCOPE_LIST if s not in granted]

    def _refresh(self):
        raw = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
        if not raw:
            raise AuthError("Not logged in to Spotify. Run: karasu.cmd auth")
        saved = json.loads(raw)
        if saved.get("client_id") != self.client_id:
            raise AuthError("spotify.client_id changed since login. Run: karasu.cmd auth")
        try:
            token = self.net.request("POST", TOKEN_URL, headers=FORM, data={
                "grant_type": "refresh_token",
                "refresh_token": saved["refresh_token"],
                "client_id": self.client_id,
            })
        except NetError as exc:
            if "invalid_grant" in str(exc) or "invalid_grant" in (exc.body or ""):
                raise AuthError("Spotify login expired (logins last 6 months). Run: karasu.cmd auth") from exc
            raise
        self._store(token)

    def token(self):
        with self.lock:
            if not self.access_token or time.time() >= self.expires_at:
                self._refresh()
            return self.access_token

    def call(self, method, path, params=None, body=None, ttl=0):
        url = path if path.startswith("http") else API + path
        headers = {"Authorization": f"Bearer {self.token()}"}
        return self.net.request(method, url, params=params, json_body=body, headers=headers, ttl=ttl)

    def paged(self, path, params=None, limit=50, max_items=None):
        out = []
        url = path
        query = {**(params or {}), "limit": limit}
        while True:
            page = self.call("GET", url, params=query) or {}
            items = page.get("items") or []
            out.extend(items)
            if max_items and len(out) >= max_items:
                return out[:max_items]
            nxt = page.get("next")
            if not nxt or not items:
                return out
            url, query = nxt, None

    def me(self):
        return self.call("GET", "/me")

    def top(self, kind, time_range, max_items=100):
        return self.paged(f"/me/top/{kind}", {"time_range": time_range}, limit=50, max_items=max_items)

    def following(self, limit=50):
        data = self.call("GET", "/me/following", params={"type": "artist", "limit": limit}) or {}
        return data.get("artists") or {}

    def search_artists(self, query, limit=10, ttl=30 * 86400):
        params = {"q": query, "type": "artist", "limit": min(limit, 10), "market": "from_token"}
        data = self.call("GET", "/search", params=params, ttl=ttl) or {}
        return (data.get("artists") or {}).get("items") or []

    def recently_played(self, after_ms=None):
        params = {"limit": 50}
        if after_ms:
            params["after"] = int(after_ms)
        return (self.call("GET", "/me/player/recently-played", params=params) or {}).get("items") or []

    def saved_tracks(self, max_items=None):
        return self.paged("/me/tracks", limit=50, max_items=max_items)

    def playlists(self):
        return self.paged("/me/playlists", limit=50)

    def playlist(self, playlist_id):
        return self.call("GET", f"/playlists/{playlist_id}")

    def playlist_items(self, playlist_id):
        return self.paged(f"/playlists/{playlist_id}/items", limit=50)

    def create_playlist(self, name, description="", public=False):
        return self.call("POST", "/me/playlists", body={
            "name": name, "public": bool(public), "description": description})

    def update_playlist(self, playlist_id, description):
        return self.call("PUT", f"/playlists/{playlist_id}", body={"description": description})

    def add_items(self, playlist_id, uris, position=None):
        result = None
        for i, part in enumerate(chunks(uris, 100)):
            body = {"uris": part}
            if position is not None:
                body["position"] = position + i * 100
            result = self.call("POST", f"/playlists/{playlist_id}/items", body=body)
        return result

    def replace_items(self, playlist_id, uris):
        return self.net.request("PUT", f"{API}/playlists/{playlist_id}/items", json_body={"uris": list(uris)[:100]},
                                headers={"Authorization": f"Bearer {self.token()}"}, attempts=1)

    def remove_items(self, playlist_id, uris):
        result = None
        for part in chunks(uris, 100):
            result = self.call("DELETE", f"/playlists/{playlist_id}/items",
                               body={"items": [{"uri": u} for u in part]})
        return result

    def search_tracks(self, query, limit=5, ttl=30 * 86400):
        params = {"q": query, "type": "track", "limit": min(limit, 10), "market": "from_token"}
        data = self.call("GET", "/search", params=params, ttl=ttl) or {}
        return (data.get("tracks") or {}).get("items") or []

    def track(self, track_id):
        return self.call("GET", f"/tracks/{track_id}", params={"market": "from_token"}, ttl=30 * 86400)

    def player_state(self):
        return self.call("GET", "/me/player", params={"additional_types": "track"}) or {}

    def devices(self):
        return (self.call("GET", "/me/player/devices") or {}).get("devices") or []

    def player(self, method, path, params=None, body=None, timeout=10.0):
        # One try, no retries: a sleeping Spotify answers 404 or 502, and the caller has to know right away.
        try:
            resp = self.net.client.request(method, API + path, params=params, json=body, timeout=timeout,
                                           headers={"Authorization": f"Bearer {self.token()}"})
        except httpx.TransportError as exc:
            raise NetError(f"Spotify didn't answer ({type(exc).__name__})")
        if resp.status_code >= 400:
            raise NetError(f"Spotify HTTP {resp.status_code}", resp.status_code, resp.text[:500])
        if not resp.content:
            return {}
        try:
            return resp.json()
        except ValueError:
            return {}

    def play(self, uris=None, offset=None, position_ms=None, device_id=None, context_uri=None, offset_uri=None):
        body = {}
        if context_uri:
            body["context_uri"] = context_uri
            if offset_uri:
                body["offset"] = {"uri": offset_uri}
        elif uris:
            body["uris"] = list(uris)[:100]
        if offset is not None and "offset" not in body:
            body["offset"] = {"position": int(offset)}
        if position_ms is not None:
            body["position_ms"] = int(position_ms)
        params = {"device_id": device_id} if device_id else None
        return self.player("PUT", "/me/player/play", params=params, body=body or None)

    def player_command(self, method, path, params=None, body=None):
        return self.net.request(method, API + path, params=params, json_body=body,
                                headers={"Authorization": f"Bearer {self.token()}"})

    def save_tracks(self, uris):
        result = None
        for part in chunks(uris, 40):
            result = self.player_command("PUT", "/me/library", params={"uris": ",".join(part)})
        return result

    def unsave_tracks(self, uris):
        result = None
        for part in chunks(uris, 40):
            result = self.player_command("DELETE", "/me/library", params={"uris": ",".join(part)})
        return result

    def upload_cover(self, playlist_id, jpeg_b64):
        return self.net.request("PUT", f"{API}/playlists/{playlist_id}/images", data=jpeg_b64,
                                headers={"Authorization": f"Bearer {self.token()}", "Content-Type": "image/jpeg"})
