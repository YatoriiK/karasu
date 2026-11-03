API = "https://ws.audioscrobbler.com/2.0/"
DAY = 86400
NOISE_TAGS = {
    "seen live", "favorites", "favourite", "favorite", "favourites", "my favorite", "albums i own",
    "spotify", "check out", "love", "loved", "awesome", "beautiful", "cool", "good", "great", "amazing",
    "best", "under 2000 listeners", "all", "music", "fav", "favs", "to listen", "owned",
}


def _list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class LastFM:
    def __init__(self, net, api_key):
        self.net = net
        self.key = (api_key or "").strip()

    @property
    def enabled(self):
        return bool(self.key)

    def _call(self, method, ttl=30 * DAY, **params):
        if not self.key:
            return None
        query = {"method": method, "api_key": self.key, "format": "json", "autocorrect": 1, **params}
        return self.net.get(API, params=query, ttl=ttl)

    def similar(self, artist, limit=50):
        data = self._call("artist.getSimilar", artist=artist, limit=limit) or {}
        out = []
        for item in _list((data.get("similarartists") or {}).get("artist")):
            try:
                match = float(item.get("match") or 0)
            except ValueError:
                match = 0.0
            out.append({"name": item.get("name"), "match": match, "mbid": item.get("mbid") or None})
        return [o for o in out if o["name"]]

    def info(self, artist):
        data = self._call("artist.getInfo", artist=artist) or {}
        node = data.get("artist")
        if not node:
            return None
        stats = node.get("stats") or {}
        return {
            "name": node.get("name"),
            "mbid": node.get("mbid") or None,
            "listeners": _int(stats.get("listeners")),
            "playcount": _int(stats.get("playcount")),
        }

    def top_tags(self, artist, limit=25):
        data = self._call("artist.getTopTags", artist=artist) or {}
        out = []
        for item in _list((data.get("toptags") or {}).get("tag")):
            name = (item.get("name") or "").strip().lower()
            count = _int(item.get("count")) or 0
            if name and count > 0 and name not in NOISE_TAGS:
                out.append((name, count))
        return out[:limit]

    def tag_top_artists(self, tag, page=1, limit=50):
        data = self._call("tag.getTopArtists", tag=tag, page=page, limit=limit, ttl=14 * DAY) or {}
        return [a.get("name") for a in _list((data.get("topartists") or {}).get("artist")) if a.get("name")]

    def top_tracks(self, artist, limit=20):
        data = self._call("artist.getTopTracks", artist=artist, limit=limit) or {}
        return [t.get("name") for t in _list((data.get("toptracks") or {}).get("track")) if t.get("name")]
