import re

API = "https://musicbrainz.org/ws/2"
DAY = 86400
_LUCENE = re.compile(r'([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)')


def lucene(text):
    return _LUCENE.sub(r"\\\1", text or "")


class MusicBrainz:
    def __init__(self, net):
        self.net = net

    def _get(self, path, params=None, ttl=90 * DAY):
        query = {"fmt": "json", **(params or {})}
        return self.net.get(f"{API}{path}", params=query, ttl=ttl)

    def isrc_recordings(self, isrc):
        data = self._get(f"/isrc/{isrc}", {"inc": "artist-credits"}) or {}
        return data.get("recordings") or []

    def search_recordings(self, artist, title, limit=10):
        query = f'recording:"{lucene(title)}" AND artist:"{lucene(artist)}"'
        data = self._get("/recording", {"query": query, "limit": limit}) or {}
        return data.get("recordings") or []

    def search_artist(self, name, limit=5):
        data = self._get("/artist", {"query": f'artist:"{lucene(name)}"', "limit": limit}) or {}
        return data.get("artists") or []

    def search_release_groups(self, query, limit=100, offset=0):
        data = self._get("/release-group", {"query": query, "limit": limit, "offset": offset}, ttl=7 * DAY) or {}
        return data.get("release-groups") or []

    def release_groups(self, artist_mbid, limit=100):
        data = self._get("/release-group", {"artist": artist_mbid, "limit": limit}) or {}
        return data.get("release-groups") or []

    def artist(self, mbid, inc="genres+tags"):
        return self._get(f"/artist/{mbid}", {"inc": inc}) or {}

    def genres(self, offset=0, limit=100):
        return self._get("/genre/all", {"limit": limit, "offset": offset}, ttl=30 * DAY) or {}

    def url_artists(self, urls):
        params = [("resource", u) for u in urls] + [("inc", "artist-rels"), ("fmt", "json")]
        data = self.net.get(f"{API}/url", params=params, ttl=90 * DAY) or {}
        return data.get("urls") or ([data] if data.get("resource") else [])
