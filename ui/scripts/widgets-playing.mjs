import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) =>
  route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
);
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("karasu-look", JSON.stringify({ state: { look: { fx: { npArt: "vinyl" } }, shared: { fx: { npArt: "vinyl" } } }, version: 2 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
});
const api = (method, path, body) =>
  page.evaluate(
    async ([m, p, b, root]) => (await fetch(root + p, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined })).json(),
    [method, path, body ?? null, base],
  );
const item = (kind, x, y, w, h, props = {}) => ({ id: `${kind}-${Math.random().toString(36).slice(2, 8)}`, kind, x, y, w, h, r: 0, z: 1, style: {}, props });
await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const original = (await api("GET", "/api/layouts")).active;
let made = null;
try {
  const layout = await api("POST", "/api/layouts", {
    name: "widget test playing",
    data: {
      canvas: { w: 1280, h: 620 },
      grid: 8,
      snap: true,
      wallpaper: null,
      items: [
        item("record", 20, 16, 300, 340, { kind: "vinyl", rpm: "33", tonearm: true, caption: true }),
        item("ring", 340, 16, 320, 320, { bars: 80, sensitivity: 1.2, art: true, spin: true }),
        item("orb", 680, 16, 220, 220, { color: "art", pulse: 1.4 }),
        item("globe", 920, 16, 340, 360, { source: "playing", caption: true }),
        item("meters", 20, 380, 420, 170, { count: "2", style: "analog", sensitivity: 1.2 }),
        item("ticker", 460, 380, 800, 60, { source: "playing", speed: 90, style: "led" }),
        item("lyrics", 460, 460, 800, 150, { lines: 3, align: "center" }),
      ],
    },
  });
  made = layout.id;
  await api("PUT", `/api/layouts/active/${layout.id}`);
  await page.goto(`${base}/?desk=${layout.id}#/explore/genre/shoegaze`, { waitUntil: "load" });
  await page.waitForSelector("main h2", { timeout: 90000 });
  await page.locator("main [class*='grid items-center']").first().dblclick();
  await page.waitForTimeout(2500);
  await page.locator("nav[aria-label='Main'] a[aria-label='Desk']").click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/widgets-playing.png` });
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/meters-${i}.png`, clip: { x: 108, y: 508, width: 444, height: 182 } });
  }
  await page.locator("button[aria-label='Open Now Playing']:visible").first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/nowplaying-vinyl.png` });
} finally {
  if (original) await api("PUT", `/api/layouts/active/${original}`);
  if (made) await api("DELETE", `/api/layouts/${made}`);
}
const after = await api("GET", "/api/layouts");
console.log(JSON.stringify({ restored: after.active, layouts: after.layouts.map((l) => l.name) }));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
