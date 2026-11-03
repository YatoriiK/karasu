import { ROOT, SHOTS } from "./paths.mjs";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const gif = readFileSync(`${ROOT}/cache/tmp/test-loop.gif`).toString("base64");
const png = readFileSync(`${ROOT}/cache/tmp/test-arrow.png`).toString("base64");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && r.url().includes("/api/assets") && problems.push(`${r.status()} ${r.url().replace(base, "")}`));
await page.route("**/api/player/spotify/**", (route) => route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
});
const api = (method, path, body) =>
  page.evaluate(
    async ([m, p, b, root]) => (await fetch(root + p, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined })).json(),
    [method, path, body ?? null, base],
  );
const upload = (b64, name, type) =>
  page.evaluate(
    async ([data, n, t, root]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return (await fetch(`${root}/api/assets?name=${encodeURIComponent(n)}`, { method: "POST", headers: { "Content-Type": t }, body: bytes })).json();
    },
    [b64, name, type, base],
  );
const recordWebm = () =>
  page.evaluate(async (root) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const start = performance.now();
    let raf = 0;
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      ctx.fillStyle = "#f4f2ec";
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "#111";
      for (let i = 0; i < 6; i++) ctx.fillRect(((t * 160 + i * 110) % 760) - 60, 50 + i * 44, 60, 26);
      raf = requestAnimationFrame(draw);
    };
    draw();
    rec.start(200);
    await new Promise((r) => setTimeout(r, 2400));
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    cancelAnimationFrame(raf);
    const blob = new Blob(chunks, { type: "video/webm" });
    return (await fetch(`${root}/api/assets?name=test-loop.webm&w=640&h=360`, { method: "POST", headers: { "Content-Type": "video/webm" }, body: blob })).json();
  }, base);
const setLook = async (look) => {
  await page.evaluate((v) => localStorage.setItem("karasu-look", v), JSON.stringify({ state: { look, preset: null, saved: [] }, version: 1 }));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1800);
};
const changes = async (rect) => {
  const clip = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(4, rect.w), height: Math.max(4, rect.h) };
  const a = await page.screenshot({ clip });
  await page.waitForTimeout(330);
  const b = await page.screenshot({ clip });
  return Buffer.compare(a, b) !== 0;
};
const image = (asset, ink, x, y) => ({ id: `img-${ink}-${x}-${y}`, kind: "image", x, y, w: 360, h: 203, r: 0, z: 1, style: {}, props: { asset, fit: "contain", ink } });

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const original = (await api("GET", "/api/layouts")).active;
const assets = [];
const extra = [];
let made = null;
const report = {};
try {
  const g = await upload(gif, "test-loop.gif", "image/gif");
  const p = await upload(png, "test-arrow.png", "image/png");
  const v = await recordWebm();
  assets.push(g.id, p.id, v.id);
  report.uploaded = { gif: [g.mime, g.frames, g.animated], png: [p.mime, p.frames, p.animated], video: [v.mime, v.video, v.w, v.h, v.frames] };

  const canvas = { w: 1280, h: 620 };
  const layout = await api("POST", "/api/layouts", {
    name: "media test",
    data: {
      canvas,
      grid: 8,
      snap: true,
      wallpaper: { asset: g.id, fit: "cover", position: "center", dim: 0.35, blur: 0, mono: true },
      items: [image(g.id, "ink", 40, 30), image(g.id, "original", 450, 30), image(v.id, "original", 860, 30), image(v.id, "ink", 40, 300), image(g.id, "light", 450, 300), image(g.id, "silhouette", 860, 300)],
    },
  });
  made = layout.id;
  await api("PUT", `/api/layouts/active/${layout.id}`);
  await page.goto(`${base}/?desk=${layout.id}#/`, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/media-desk.png` });
  const rects = await page.evaluate(() => {
    const box = (el, kind) => {
      const r = el.getBoundingClientRect();
      return { kind, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return [
      ...[...document.querySelectorAll("main video")].map((el) => box(el, "video")),
      ...[...document.querySelectorAll("main img[src*='/api/assets/']")].map((el) => box(el, "gif original")),
      ...[...document.querySelectorAll("main span[style*='mask-mode']")].map((el) => box(el, `gif ${el.style.maskMode}`)),
    ];
  });
  report.stickers = [];
  for (const r of rects) report.stickers.push(`${r.kind}: ${(await changes(r)) ? "moving" : "STILL"}`);
  report.videos = await page.evaluate(() => [...document.querySelectorAll("video")].map((el) => ({ playing: !el.paused, t: Math.round(el.currentTime * 10) / 10, filter: el.style.filter || "none" })));

  for (const [label, asset] of [["gif", g.id], ["video", v.id]]) {
    const desk = await api("POST", "/api/layouts", { name: `${label} wallpaper test`, data: { canvas, grid: 8, snap: true, wallpaper: { asset, fit: "cover", position: "center", dim: 0.2, blur: 0, mono: false }, items: [] } });
    extra.push(desk.id);
    await api("PUT", `/api/layouts/active/${desk.id}`);
    await page.goto(`${base}/?desk=${desk.id}#/`, { waitUntil: "load" });
    await page.waitForTimeout(3200);
    await page.screenshot({ path: `${out}/media-${label}-wallpaper.png` });
    report[`${label}Wallpaper`] = {
      moving: await changes({ x: 120, y: 90, w: 1180, h: 640 }),
      video: await page.evaluate(() => {
        const el = document.querySelector(".bg-paper video");
        return el ? { playing: !el.paused, t: Math.round(el.currentTime * 10) / 10, fit: el.style.objectFit } : null;
      }),
    };
  }

  await setLook({ fx: { cursor: "image", cursorAsset: p.id, cursorSize: 28 } });
  report.nativeCursor = await page.evaluate(() => ({ body: getComputedStyle(document.body).cursor.slice(0, 160), soft: "cursorSoft" in document.documentElement.dataset }));

  for (const scale of [1, 1.2]) {
    await setLook({ scale, fx: { cursor: "image", cursorAsset: p.id, cursorSize: 64, cursorHot: "tip" } });
    await page.mouse.move(690, 440);
    await page.mouse.move(700, 450);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/cursor-soft-${scale}.png`, clip: { x: 640, y: 390, width: 160, height: 160 } });
    report[`softCursor@${scale}`] = await page.evaluate(() => {
      const el = document.querySelector("[data-soft-cursor]");
      return el ? { opacity: el.style.opacity, transform: el.style.transform, soft: "cursorSoft" in document.documentElement.dataset, bodyCursor: getComputedStyle(document.body).cursor } : null;
    });
  }

  await setLook({ fx: { cursor: "image", cursorAsset: g.id, cursorSize: 72, cursorHot: "center", cursorInk: "ink", cursorTrail: "ink" } });
  for (let i = 0; i <= 24; i++) {
    await page.mouse.move(300 + i * 30, 300 + Math.sin(i / 3) * 90);
    await page.waitForTimeout(16);
  }
  await page.screenshot({ path: `${out}/cursor-gif-trail.png`, clip: { x: 240, y: 160, width: 900, height: 300 } });
  report.trail = await page.evaluate(() => document.querySelector("[data-cursor-trail]")?.getAttribute("data-cursor-trail") ?? null);

  await setLook({ fx: { cursorTrail: "sparkle" } });
  for (let i = 0; i <= 20; i++) {
    await page.mouse.move(400 + i * 28, 520 - i * 8);
    await page.waitForTimeout(16);
  }
  await page.screenshot({ path: `${out}/cursor-sparkle.png`, clip: { x: 340, y: 300, width: 760, height: 300 } });
} finally {
  await page.evaluate(() => localStorage.removeItem("karasu-look"));
  if (original) await api("PUT", `/api/layouts/active/${original}`);
  for (const id of [made, ...extra]) if (id) await api("DELETE", `/api/layouts/${id}`);
  for (const id of assets) await api("DELETE", `/api/assets/${id}`);
}
const after = await api("GET", "/api/layouts");
report.restored = { active: after.active, layouts: after.layouts.map((l) => l.name), testAssetsLeft: (await api("GET", "/api/assets")).filter((a) => a.name.startsWith("test-")).length };
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
