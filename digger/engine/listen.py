import sys
import threading
import time
import warnings

import numpy as np

BANDS = 64
RATE = 48000
SIZE = 4096
RANGE = 54.0
QUIETEST = -70.0
GATE = 4e-4


def band_edges(count=BANDS, low=35.0, high=15000.0):
    return np.geomspace(low, high, count + 1)


def band_index(freqs, edges):
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        idx = np.where((freqs >= lo) & (freqs < hi))[0]
        if not len(idx):
            idx = np.array([int(np.argmin(np.abs(freqs - (lo + hi) / 2)))])
        out.append(idx)
    return out


class Levels:
    def __init__(self, count=BANDS):
        self.count = count
        freqs = np.fft.rfftfreq(SIZE, 1 / RATE)
        edges = band_edges(count)
        self.index = band_index(freqs, edges)
        centers = np.sqrt(edges[:-1] * edges[1:])
        self.tilt = 3.0 * np.log2(centers / 1000.0)
        self.window = np.hanning(SIZE).astype(np.float32)
        self.buffer = np.zeros(SIZE, dtype=np.float32)
        self.top = QUIETEST

    def push(self, mono):
        mono = np.asarray(mono, dtype=np.float32)
        if len(mono) >= SIZE:
            self.buffer = mono[-SIZE:].copy()
        else:
            self.buffer = np.concatenate([self.buffer[len(mono):], mono])
        rms = float(np.sqrt(np.mean(np.square(mono)))) if len(mono) else 0.0
        if rms < GATE:
            self.top = max(QUIETEST, self.top - 0.5)
            return np.zeros(self.count, dtype=np.float32), 0.0
        power = np.square(np.abs(np.fft.rfft(self.buffer * self.window)) / SIZE)
        bands = np.sqrt(np.array([power[i].mean() for i in self.index]))
        db = 20 * np.log10(bands + 1e-12) + self.tilt
        self.top = max(float(db.max()), self.top - 0.06, QUIETEST)
        level = np.clip((db - self.top + RANGE) / RANGE, 0.0, 1.0)
        return level.astype(np.float32), min(1.0, rms * 4)


def _com_enter():
    if sys.platform != "win32":
        return False
    import ctypes
    return ctypes.windll.ole32.CoInitializeEx(None, 0) in (0, 1)


def _com_leave(entered):
    if entered:
        import ctypes
        ctypes.windll.ole32.CoUninitialize()


class SystemAudio:
    def __init__(self):
        self.lock = threading.Lock()
        self.clients = 0
        self.thread = None
        self.frame = (0.0, np.zeros(BANDS, dtype=np.float32), 0.0)
        self.error = None

    def subscribe(self):
        with self.lock:
            self.clients += 1
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, name="system-audio", daemon=True)
                self.thread.start()

    def unsubscribe(self):
        with self.lock:
            self.clients = max(0, self.clients - 1)

    def _run(self):
        try:
            import soundcard as sc
        except Exception as exc:
            self.error = f"System audio isn't available: {exc}"
            with self.lock:
                self.thread = None
            return
        entered = _com_enter()
        try:
            while True:
                with self.lock:
                    if self.clients <= 0:
                        self.thread = None
                        return
                self._capture(sc)
        finally:
            _com_leave(entered)

    def _capture(self, sc):
        warnings.filterwarnings("ignore", module="soundcard")
        levels = Levels()
        while self.clients > 0:
            try:
                speaker = sc.default_speaker()
                mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
                with mic.recorder(samplerate=RATE, channels=2, blocksize=512) as rec:
                    self.error = None
                    name = speaker.name
                    checked = time.monotonic()
                    while self.clients > 0:
                        chunk = rec.record(numframes=1024)
                        mono = chunk.mean(axis=1) if chunk.ndim == 2 else chunk
                        bands, rms = levels.push(mono)
                        self.frame = (time.monotonic(), bands, rms)
                        if time.monotonic() - checked > 2:
                            checked = time.monotonic()
                            if sc.default_speaker().name != name:
                                break
            except Exception as exc:
                self.error = str(exc)
                self.frame = (time.monotonic(), np.zeros(BANDS, dtype=np.float32), 0.0)
                time.sleep(1.5)


SYSTEM = SystemAudio()
