API = "https://api.deezer.com"
DAY = 86400


class Deezer:
    def __init__(self, net):
        self.net = net

    def _get(self, path, params=None, ttl=14 * DAY):
        return self.net.get(f"{API}{path}", params=params, ttl=ttl)

    def _data(self, path, params=None, ttl=14 * DAY):
        payload = self._get(path, params, ttl)
        return (payload or {}).get("data") or []

    def track(self, track_id, fresh=False):
        return self._get(f"/track/{track_id}", ttl=0 if fresh else 30 * DAY)

    def track_by_isrc(self, isrc):
        payload = self._get(f"/track/isrc:{isrc}", ttl=60 * DAY)
        return payload if payload and payload.get("id") else None

    def artist(self, artist_id):
        return self._get(f"/artist/{artist_id}", ttl=14 * DAY)

    def artist_top(self, artist_id, limit=10):
        return self._data(f"/artist/{artist_id}/top", {"limit": limit}, ttl=14 * DAY)

    def artist_related(self, artist_id, limit=25):
        return self._data(f"/artist/{artist_id}/related", {"limit": limit}, ttl=30 * DAY)

    def artist_albums(self, artist_id, limit=100):
        return self._data(f"/artist/{artist_id}/albums", {"limit": limit}, ttl=14 * DAY)

    def album(self, album_id):
        return self._get(f"/album/{album_id}", ttl=60 * DAY)

    def chart(self, limit=100):
        return self._data("/chart/0/tracks", {"limit": limit}, ttl=6 * 3600)

    def chart_artists(self, limit=50):
        return self._data("/chart/0/artists", {"limit": limit}, ttl=6 * 3600)

    def search(self, kind, query, limit=25, index=0, ttl=14 * DAY):
        return self._data(f"/search/{kind}", {"q": query, "limit": limit, "index": index}, ttl=ttl)

    def search_artist(self, name, limit=10):
        return self.search("artist", _q(name), limit=limit)

    def search_track(self, artist, title, limit=10):
        return self.search("track", f'artist:"{_q(artist)}" track:"{_q(title)}"', limit=limit)

    def search_label_albums(self, label, limit=100, index=0):
        return self.search("album", f'label:"{_q(label)}"', limit=limit, index=index, ttl=7 * DAY)

    def search_album(self, artist, title, limit=10):
        return self.search("album", f'artist:"{_q(artist)}" album:"{_q(title)}"', limit=limit, ttl=30 * DAY)


def _q(text):
    return (text or "").replace('"', " ").strip()
