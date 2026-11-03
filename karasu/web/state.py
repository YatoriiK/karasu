import threading
import time

from fastapi import HTTPException


class AppState:
    def __init__(self):
        self.ctx = None
        self.bus = None
        self.jobs = None
        self.corpus = None
        self.server = None
        self.cache = {}
        self.cache_lock = threading.Lock()

    def memo(self, key, ttl, fn):
        now = time.time()
        with self.cache_lock:
            hit = self.cache.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
        value = fn()
        with self.cache_lock:
            self.cache[key] = (now, value)
        return value

    def invalidate(self, prefix=""):
        with self.cache_lock:
            for key in [k for k in self.cache if k.startswith(prefix)]:
                self.cache.pop(key, None)


STATE = AppState()


def ctx():
    if STATE.ctx is None:
        raise HTTPException(503, "engine starting")
    return STATE.ctx
