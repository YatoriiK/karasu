API = "https://api.discogs.com"
DAY = 86400


class Discogs:
    def __init__(self, net, token):
        self.net = net
        self.token = (token or "").strip()

    @property
    def enabled(self):
        return bool(self.token)

    def _get(self, path, params=None, ttl=30 * DAY):
        if not self.token:
            return None
        headers = {"Authorization": f"Discogs token={self.token}"}
        return self.net.get(f"{API}{path}", params=params, headers=headers, ttl=ttl)

    def search(self, page=1, per_page=100, **params):
        data = self._get("/database/search", {**params, "page": page, "per_page": per_page}) or {}
        return data.get("results") or []

    def master(self, master_id):
        return self._get(f"/masters/{master_id}", ttl=90 * DAY)

    def release(self, release_id):
        return self._get(f"/releases/{release_id}", ttl=90 * DAY)
