import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && !r.url().includes("/api/art/") && problems.push(`${r.status()} ${r.url().replace(base, "")}`));
await page.route("**/api/player/spotify/**", (route) =>
  route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
);
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
});

const api = (method, path, body) =>
  page.evaluate(
    async ([m, p, b, root]) => {
      const r = await fetch(root + p, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
      return r.json();
    },
    [method, path, body ?? null, base],
  );

const item = (kind, x, y, w, h, props = {}, z = 1) => ({ id: `${kind}-${Math.random().toString(36).slice(2, 8)}`, kind, x, y, w, h, r: 0, z, style: {}, props });
const desks = [
  [
    item("globe", 20, 16, 300, 330, { source: "top", caption: true }),
    item("record", 340, 16, 250, 300, { kind: "vinyl", rpm: "33", tonearm: true, caption: true }),
    item("ring", 610, 16, 290, 290, { bars: 72, sensitivity: 1, art: true, spin: true }),
    item("orb", 920, 16, 170, 170, { color: "art", pulse: 1 }),
    item("meters", 920, 200, 340, 140, { count: "2", style: "analog", sensitivity: 1 }),
    item("ink", 20, 366, 300, 236, { particles: 900, speed: 1, trail: 0.06, react: true }),
    item("wall", 340, 336, 300, 266, { source: "saved", columns: 5, interval: 2, grayscale: false, gap: 4 }),
    item("ticker", 660, 326, 600, 56, { source: "playing", speed: 70, style: "led" }),
    item("heatmap", 660, 396, 400, 130, { weeks: 26, labels: true }),
    item("focus", 1080, 396, 180, 180, { work: 25, rest: 5, pause: false, chime: true }),
  ],
  [
    item("tastemap", 20, 16, 560, 330),
    item("record", 600, 16, 300, 200, { kind: "tape", caption: true }),
    item("record", 920, 16, 260, 300, { kind: "cd", rpm: "33", caption: true }),
    item("lyrics", 20, 366, 560, 236, { lines: 5, align: "center" }),
    item("meters", 600, 336, 300, 120, { count: "2", style: "led", sensitivity: 1 }),
    item("ticker", 600, 476, 580, 60, { source: "custom", text: "烏 karasu · dig deeper", speed: 80, style: "plain" }),
  ],
];

await page.goto(`${base}/#/explore/genre/slowcore`, { waitUntil: "load" });
await page.waitForSelector("main h2", { timeout: 90000 });
const original = (await api("GET", "/api/layouts")).active;
const made = [];
const report = {};
try {
  const row = page.locator("main [class*='grid items-center']").first();
  await row.dblclick();
  await page.waitForTimeout(2500);
  await row.click({ button: "right" });
  await page.waitForTimeout(500);
  report.menu = await page.locator("[role='menu']").last().innerText();
  await page.screenshot({ path: `${out}/menu-right-click.png` });
  await page.locator("[role='menuitem']", { hasText: "Share" }).hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/menu-share.png` });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await row.click({ button: "right" });
  await page.locator("[role='menuitem']", { hasText: "Copy song link" }).click();
  await page.waitForTimeout(1200);
  report.clipboard = await page.evaluate(() => navigator.clipboard.readText());

  for (const [i, items] of desks.entries()) {
    const layout = await api("POST", "/api/layouts", { name: `widget test ${i + 1}`, data: { canvas: { w: 1280, h: 620 }, grid: 8, snap: true, wallpaper: null, items } });
    made.push(layout.id);
    await api("PUT", `/api/layouts/active/${layout.id}`);
    await page.goto(`${base}/?desk=${layout.id}#/`, { waitUntil: "load" });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `${out}/widgets-${i + 1}.png` });
  }

  await page.goto(`${base}/#/settings`, { waitUntil: "load" });
  await page.waitForSelector("#effects", { timeout: 30000 });
  await page.locator("#effects button[aria-label='Weather']").click();
  await page.locator("[role='menuitem']", { hasText: "Snow" }).click();
  await page.locator("#effects button", { hasText: "Scanlines" }).click();
  await page.locator("#cursor button", { hasText: "Ink dot" }).click();
  await page.waitForTimeout(400);
  await page.locator("#effects").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/settings-effects.png` });
  await page.goto(`${base}/#/library`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/effects-snow.png` });
} finally {
  if (original) await api("PUT", `/api/layouts/active/${original}`);
  for (const id of made) await api("DELETE", `/api/layouts/${id}`);
}
const after = await api("GET", "/api/layouts");
report.restored = { active: after.active, layouts: after.layouts.map((l) => l.name) };
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
