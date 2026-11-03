import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const SCENES = [
  ["flow", "Ink flow"],
  ["ripples", "Ripples"],
  ["mountains", "Ink mountains"],
  ["ridges", "Ridgelines"],
  ["smoke", "Incense smoke"],
  ["aurora", "Light curtains"],
  ["warp", "Warp"],
  ["bloom", "Ink bloom"],
  ["constellation", "Constellation"],
];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
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
const inked = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas[data-scene]:not([class*='h-full w-full'][data-scene] ~ *)");
    const all = [...document.querySelectorAll("canvas[data-scene]")];
    const layer = all.find((c) => c.className.includes("absolute inset-0")) ?? canvas;
    if (!layer) return null;
    const ctx = layer.getContext("2d");
    const { width, height } = layer;
    const data = ctx.getImageData(0, 0, width, height).data;
    let lit = 0;
    let n = 0;
    for (let y = 0; y < height; y += 9) for (let x = 0; x < width; x += 9) {
      n++;
      if (data[(y * width + x) * 4 + 3] > 8) lit++;
    }
    return { scene: layer.dataset.scene, lit: Math.round((lit / n) * 1000) / 10 };
  });

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const original = (await api("GET", "/api/layouts")).active;
let made = null;
const report = {};
try {
  const layout = await api("POST", "/api/layouts", {
    name: "scene test",
    data: {
      canvas: { w: 1280, h: 620 },
      grid: 8,
      snap: true,
      wallpaper: null,
      items: [{ id: "scene-w", kind: "scene", x: 1000, y: 380, w: 260, h: 220, r: 0, z: 1, style: {}, props: { scene: "mountains", color: "ink", sensitivity: 1.2 } }],
    },
  });
  made = layout.id;
  await api("PUT", `/api/layouts/active/${layout.id}`);
  await page.goto(`${base}/?desk=${layout.id}#/explore/genre/shoegaze`, { waitUntil: "load" });
  await page.waitForSelector("main h2", { timeout: 90000 });
  await page.locator("main [class*='grid items-center']").first().dblclick();
  await page.waitForTimeout(2500);
  for (const [kind, label] of SCENES) {
    await page.locator("nav[aria-label='Main'] a[aria-label='Settings']").click();
    await page.waitForSelector("#effects", { timeout: 30000 });
    await page.locator("button[aria-label='Music visual']").click();
    await page.locator("[role='menuitem']", { hasText: label }).first().click();
    await page.locator("nav[aria-label='Main'] a[aria-label='Desk']").click();
    await page.waitForTimeout(3200);
    await page.screenshot({ path: `${out}/scene-${kind}.png` });
    report[kind] = await inked();
  }
  report.playing = await page.evaluate(() => JSON.parse(localStorage.getItem("cd-player") || "{}").state?.queue?.length ?? 0);
} finally {
  if (original) await api("PUT", `/api/layouts/active/${original}`);
  if (made) await api("DELETE", `/api/layouts/${made}`);
}
const after = await api("GET", "/api/layouts");
report.restored = { active: after.active, layouts: after.layouts.map((l) => l.name) };
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
