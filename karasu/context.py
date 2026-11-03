import logging
import sys

from . import DATA, config
from .db import DB
from .net import Net
from .sources.deezer import Deezer
from .sources.discogs import Discogs
from .sources.lastfm import LastFM
from .sources.musicbrainz import MusicBrainz
from .sources.spotify import Spotify


def _logger():
    log = logging.getLogger("karasu")
    if not log.handlers:
        log.setLevel(logging.INFO)
        (DATA / "logs").mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(DATA / "logs" / "karasu.log", encoding="utf-8")
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(fh)
        log.addHandler(sh)
    return log


class Ctx:
    def __init__(self, cfg=None, db=None):
        config.ensure_file()
        self.db = db or DB()
        self.cfg = cfg or config.load(self.db.settings())
        self.net = Net(config.user_agent(self.cfg))
        self.dz = Deezer(self.net)
        self.lfm = LastFM(self.net, self.cfg["lastfm"]["api_key"])
        self.mb = MusicBrainz(self.net)
        self.dg = Discogs(self.net, self.cfg["discogs"]["token"])
        self.sp = Spotify(self.net, self.cfg["spotify"]["client_id"], self.cfg["spotify"]["redirect_port"])
        self.logger = _logger()

    def log(self, message):
        self.logger.info(message)

    def close(self):
        self.net.cache.prune_host("ws.audioscrobbler.com", 100 * 1024 * 1024)
        self.net.close()
        self.db.close()
