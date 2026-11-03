import asyncio
import json
import logging
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

from ..util import now_iso

log = logging.getLogger("digger")


class Cancelled(Exception):
    pass


class EventBus:
    def __init__(self):
        self.loop = None
        self.queues = set()
        self.lock = threading.Lock()

    def attach(self, loop):
        self.loop = loop

    def publish(self, event):
        if self.loop is None:
            return
        with self.lock:
            queues = list(self.queues)
        for queue in queues:
            try:
                self.loop.call_soon_threadsafe(queue.put_nowait, event)
            except (RuntimeError, asyncio.QueueFull):
                pass

    async def stream(self):
        queue = asyncio.Queue(maxsize=2000)
        with self.lock:
            self.queues.add(queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"type": "ping", "t": time.time()}
                    continue
                yield event
        finally:
            with self.lock:
                self.queues.discard(queue)


class JobContext:
    def __init__(self, manager, job_id, ctx):
        self.manager = manager
        self.id = job_id
        self.ctx = ctx
        self._last = 0.0
        self.stage = None
        self.done = 0
        self.total = 0
        self.started = time.time()

    @property
    def cancelled(self):
        return self.manager.cancel_flags.get(self.id, False)

    def check(self):
        if self.cancelled:
            raise Cancelled()

    def progress(self, stage=None, done=None, total=None, force=False):
        if stage is not None:
            self.stage = stage
        if done is not None:
            self.done = done
        if total is not None:
            self.total = total
        now = time.time()
        if force or now - self._last > 0.3:
            self._last = now
            self.manager._update(self.id, status="running", stage=self.stage, done=self.done, total=self.total,
                                 started=self.started)
        self.check()

    def gpu(self):
        return self.manager.gpu


class JobManager:
    def __init__(self, ctx, bus, workers=2):
        self.ctx = ctx
        self.bus = bus
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="job")
        self.gpu = threading.Lock()
        self.lock = threading.Lock()
        self.active = {}
        self.cancel_flags = {}
        self.state = {}
        ctx.db.x("update jobs set status='interrupted' where status in ('queued', 'running')")

    def submit(self, kind, fn, params=None, key=None, label=None):
        params = params or {}
        key = key or f"{kind}:{json.dumps(params, sort_keys=True, default=str)}"
        with self.lock:
            if key in self.active:
                return self.active[key]
            job_id = uuid.uuid4().hex[:12]
            self.active[key] = job_id
        stamp = now_iso()
        self.ctx.db.x(
            "insert into jobs(id, kind, params, status, stage, done, total, created, updated) "
            "values(?,?,?,?,?,?,?,?,?)",
            (job_id, kind, json.dumps(params, default=str), "queued", label or kind, 0, 0, stamp, stamp))
        self.state[job_id] = {"id": job_id, "kind": kind, "status": "queued", "stage": label or kind,
                              "done": 0, "total": 0, "label": label or kind}
        self.bus.publish({"type": "job", **self.state[job_id]})
        self.executor.submit(self._run, job_id, kind, fn, params, key, label)
        return job_id

    def _run(self, job_id, kind, fn, params, key, label):
        jc = JobContext(self, job_id, self.ctx)
        self._update(job_id, status="running", stage=label or kind)
        try:
            result = fn(jc, **params)
            self._update(job_id, status="done", result=result, done=jc.total or jc.done, total=jc.total)
        except Cancelled:
            self._update(job_id, status="cancelled")
        except Exception as exc:
            log.error("job %s (%s) failed: %s\n%s", job_id, kind, exc, traceback.format_exc())
            self._update(job_id, status="error", error=str(exc)[:500])
        finally:
            with self.lock:
                self.active.pop(key, None)
            self.cancel_flags.pop(job_id, None)

    def _update(self, job_id, status=None, stage=None, done=None, total=None, error=None, result=None,
                started=None):
        state = self.state.setdefault(job_id, {"id": job_id})
        for name, value in (("status", status), ("stage", stage), ("done", done), ("total", total),
                            ("error", error)):
            if value is not None:
                state[name] = value
        if started and state.get("total") and state.get("done"):
            elapsed = time.time() - started
            rate = state["done"] / max(elapsed, 1e-3)
            state["eta_s"] = round((state["total"] - state["done"]) / rate) if rate > 0 else None
        if result is not None:
            state["result"] = result
        self.ctx.db.x(
            "update jobs set status=coalesce(?, status), stage=coalesce(?, stage), done=coalesce(?, done), "
            "total=coalesce(?, total), error=coalesce(?, error), result=coalesce(?, result), updated=? where id=?",
            (status, stage, done, total, error, json.dumps(result, default=str) if result is not None else None,
             now_iso(), job_id))
        event = {k: v for k, v in state.items() if k != "result"}
        if status in ("done", "error", "cancelled"):
            event["finished"] = True
            event["has_result"] = result is not None
        self.bus.publish({"type": "job", **event})

    def get(self, job_id):
        if job_id in self.state:
            return self.state[job_id]
        row = self.ctx.db.one("select * from jobs where id=?", (job_id,))
        if not row:
            return None
        data = dict(row)
        data["params"] = json.loads(data["params"] or "{}")
        data["result"] = json.loads(data["result"]) if data.get("result") else None
        return data

    def recent(self, limit=20):
        rows = self.ctx.db.q("select id, kind, status, stage, done, total, error, created, updated from jobs "
                             "order by created desc limit ?", (limit,))
        return [dict(r) for r in rows]

    def running(self):
        return [s for s in self.state.values() if s.get("status") in ("queued", "running")]

    def cancel(self, job_id):
        self.cancel_flags[job_id] = True
        return True

    def shutdown(self):
        for job_id in list(self.state):
            self.cancel_flags[job_id] = True
        self.executor.shutdown(wait=False, cancel_futures=True)
