import io
import math
import os
import tempfile
import threading
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, wait

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from . import CACHE
from .net import NetError

DEFAULT_MODEL = "laion/larger_clap_music_and_speech"
SR = 48000
WINDOW = 10 * SR
FAILED = "failed"
AUDIO_CACHE = CACHE / "audio"
AUDIO_CACHE_LIMIT = 6 * 1024 ** 3


def strip_id3(data):
    if data[:3] != b"ID3" or len(data) < 10:
        return data
    b = data[6:10]
    size = 10 + ((b[0] & 0x7F) << 21 | (b[1] & 0x7F) << 14 | (b[2] & 0x7F) << 7 | (b[3] & 0x7F))
    if data[5] & 0x10:
        size += 10
    return data[size:]


def _read(data):
    try:
        with sf.SoundFile(io.BytesIO(strip_id3(data))) as fh:
            return fh.samplerate, fh.read(dtype="float32", always_2d=True)
    except sf.LibsndfileError:
        (CACHE / "tmp").mkdir(parents=True, exist_ok=True)
        fd, path = tempfile.mkstemp(suffix=".mp3", dir=CACHE / "tmp")
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(data)
            with sf.SoundFile(path) as fh:
                return fh.samplerate, fh.read(dtype="float32", always_2d=True)
        finally:
            os.remove(path)


def decode(data):
    rate, wave = _read(data)
    wave = wave.mean(axis=1)
    if rate != SR:
        g = math.gcd(rate, SR)
        wave = resample_poly(wave, SR // g, rate // g).astype(np.float32)
    return wave


def windows(wave, count=3):
    n = len(wave)
    if n < SR * 3:
        return []
    if n <= WINDOW:
        return [wave]
    use = min(count, max(1, int(n / WINDOW + 0.5)))
    if use == 1:
        start = (n - WINDOW) // 2
        return [wave[start:start + WINDOW]]
    step = (n - WINDOW) / (use - 1)
    return [wave[int(i * step):int(i * step) + WINDOW] for i in range(use)]


def _unit(matrix):
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return matrix / np.maximum(norms, 1e-9)


def preview_path(dz_id):
    return AUDIO_CACHE / f"{int(dz_id)}.mp3"


def fetch_preview(ctx, dz_id, preview=None):
    path = preview_path(dz_id)
    if path.exists() and path.stat().st_size > 1000:
        return path.read_bytes()
    data = ctx.net.get_bytes(preview) if preview else None
    if data is None:
        try:
            fresh = ctx.dz.track(dz_id, fresh=True) or {}
        except NetError:
            return None
        data = ctx.net.get_bytes(fresh["preview"]) if fresh.get("preview") else None
    if data:
        AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return data


# Least recently played previews go first. Trims to 90% so we're not back here after the next song.
def prune_audio_cache(limit=AUDIO_CACHE_LIMIT):
    if not AUDIO_CACHE.exists():
        return 0
    files = sorted(AUDIO_CACHE.glob("*.mp3"), key=lambda p: p.stat().st_atime)
    total = sum(p.stat().st_size for p in files)
    removed = 0
    for path in files:
        if total <= limit * 0.9:
            break
        total -= path.stat().st_size
        path.unlink(missing_ok=True)
        removed += 1
    return removed


_worker = {}


def _init_worker(model_name):
    from threadpoolctl import threadpool_limits
    from transformers import ClapFeatureExtractor

    _worker["limits"] = threadpool_limits(1)
    _worker["fx"] = ClapFeatureExtractor.from_pretrained(model_name)


def _prepare(dz_id, data, want_clap=True, want_dsp=True):
    from .engine.dsp import features

    try:
        wave = decode(data)
    except Exception:
        return dz_id, FAILED
    out = {}
    if want_dsp:
        try:
            out["dsp"] = features(wave, SR)
        except Exception:
            out["dsp"] = None
    if want_clap:
        ws = windows(wave)
        if not ws:
            return dz_id, FAILED
        out["clap"] = {k: v for k, v in _worker["fx"](ws, sampling_rate=SR, return_tensors="np").items()}
    return dz_id, out


class Clap:
    _lock = threading.Lock()

    def __init__(self, model_name=DEFAULT_MODEL, device=None):
        import torch
        from transformers import ClapModel, ClapProcessor

        self.torch = torch
        self.name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.processor = ClapProcessor.from_pretrained(model_name)
        self.model = ClapModel.from_pretrained(model_name).to(self.device).eval()

    def _pooled(self, output):
        if isinstance(output, self.torch.Tensor):
            return output
        for name in ("pooler_output", "audio_embeds", "text_embeds"):
            value = getattr(output, name, None)
            if value is not None:
                return value
        return output[0]

    def from_features(self, feature_sets):
        owners, parts = [], {}
        for i, feats in enumerate(feature_sets):
            rows = len(feats["input_features"])
            owners.extend([i] * rows)
            for key, value in feats.items():
                parts.setdefault(key, []).append(value)
        inputs = {k: self.torch.from_numpy(np.concatenate(v)).to(self.device) for k, v in parts.items()}
        with self._lock, self.torch.no_grad():
            emb = self._pooled(self.model.get_audio_features(**inputs))
        emb = _unit(emb.float().cpu().numpy())
        out = np.zeros((len(feature_sets), emb.shape[1]), dtype=np.float32)
        for row, owner in zip(emb, owners):
            out[owner] += row
        return _unit(out)

    def audio(self, clips):
        feature_sets = [dict(self.processor.feature_extractor(ws, sampling_rate=SR, return_tensors="np")) for ws in clips]
        return self.from_features(feature_sets)

    def text(self, texts):
        inputs = self.processor(text=list(texts), return_tensors="pt", padding=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with self._lock, self.torch.no_grad():
            emb = self._pooled(self.model.get_text_features(**inputs))
        return _unit(emb.float().cpu().numpy())


def model_name(cfg):
    return cfg["app"].get("clap_model") or DEFAULT_MODEL


class AudioPool:
    def __init__(self, name, workers):
        for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
            os.environ[var] = "1"
        self.workers = workers
        self.executor = ProcessPoolExecutor(max_workers=workers, initializer=_init_worker, initargs=(name,))

    def shutdown(self):
        self.executor.shutdown(wait=False, cancel_futures=True)


_shared = {"clap": None, "pool": None}
_shared_lock = threading.Lock()


def shared_clap(cfg):
    with _shared_lock:
        if _shared["clap"] is None:
            _shared["clap"] = Clap(model_name(cfg))
        return _shared["clap"]


def shared_pool(cfg):
    with _shared_lock:
        if _shared["pool"] is None:
            _shared["pool"] = AudioPool(model_name(cfg), max(1, int(cfg["app"].get("workers", 8))))
        return _shared["pool"]


def release_shared():
    with _shared_lock:
        if _shared["pool"] is not None:
            _shared["pool"].shutdown()
            _shared["pool"] = None


def _store_dsp(db, dz_id, dsp):
    if not dsp:
        return
    from .engine.dsp import VERSION
    db.x("insert or replace into dsp(dz_id, tempo, energy, dyn, brightness, onset_rate, perc, version) "
         "values(?,?,?,?,?,?,?,?)",
         (dz_id, dsp.get("tempo"), dsp.get("energy"), dsp.get("dyn"), dsp.get("brightness"),
          dsp.get("onset_rate"), dsp.get("perc"), VERSION))


def process_tracks(ctx, items, want_clap=True, want_dsp=True, clap=None, pool=None, batch=32,
                   progress=None, cancelled=None):
    name = model_name(ctx.cfg)
    previews = {}
    for dz_id, preview in items:
        previews.setdefault(int(dz_id), preview)
    if not previews:
        return 0
    skip = {int(r[0].split(":", 1)[1]) for r in ctx.db.q("select key from meta where key like 'nopreview:%'")}
    todo = [(i, p) for i, p in previews.items() if i not in skip]
    if not todo:
        return 0
    if want_clap and clap is None:
        clap = Clap(name)
    own_pool = pool is None
    pool = pool or AudioPool(name, max(1, int(ctx.cfg["app"].get("workers", 8))))
    downloads = max(1, int(ctx.cfg["app"].get("download_threads", 16)))
    done = 0
    finished = 0
    pending = []

    def flush():
        nonlocal done
        if not pending:
            return
        clap_items = [(i, r["clap"]) for i, r in pending if r.get("clap")]
        vecs = clap.from_features([f for _, f in clap_items]) if clap_items else []
        with ctx.db.tx():
            for (dz_id, _), vec in zip(clap_items, vecs):
                ctx.db.put_vec(dz_id, vec, name)
            for dz_id, result in pending:
                _store_dsp(ctx.db, dz_id, result.get("dsp"))
        done += len(pending)
        pending.clear()

    queue = iter(todo)
    try:
        with ThreadPoolExecutor(max_workers=downloads) as dl:
            in_dl, in_cpu = set(), set()

            def fill():
                while len(in_dl) < downloads * 2 and len(in_cpu) < pool.workers * 6:
                    if cancelled and cancelled():
                        return
                    item = next(queue, None)
                    if item is None:
                        return
                    in_dl.add(dl.submit(lambda it: (it[0], fetch_preview(ctx, it[0], it[1])), item))

            fill()
            while in_dl or in_cpu:
                ready, _ = wait(in_dl | in_cpu, return_when=FIRST_COMPLETED)
                for fut in ready:
                    if fut in in_dl:
                        in_dl.discard(fut)
                        dz_id, data = fut.result()
                        if data:
                            in_cpu.add(pool.executor.submit(_prepare, dz_id, data, want_clap, want_dsp))
                        else:
                            ctx.db.set_meta(f"nopreview:{dz_id}", True)
                            finished += 1
                    else:
                        in_cpu.discard(fut)
                        dz_id, result = fut.result()
                        finished += 1
                        if isinstance(result, dict):
                            pending.append((dz_id, result))
                            if len(pending) >= batch:
                                flush()
                        else:
                            ctx.db.set_meta(f"nopreview:{dz_id}", True)
                        if progress and finished % 25 == 0:
                            progress(finished, len(todo))
                fill()
            flush()
    finally:
        if own_pool:
            pool.shutdown()
    if progress:
        progress(len(todo), len(todo))
    return done


def embed_tracks(ctx, items, clap=None, batch=32, progress=None, pool=None, cancelled=None):
    name = model_name(ctx.cfg)
    items = list(items)
    have = set(ctx.db.vecs([int(i) for i, _ in items], model=name).keys())
    todo = [(i, p) for i, p in items if int(i) not in have]
    return process_tracks(ctx, todo, want_clap=True, want_dsp=True, clap=clap, pool=pool, batch=batch,
                          progress=progress, cancelled=cancelled)
