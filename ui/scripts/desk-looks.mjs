import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) => route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 })));
const api = (method, path, body) =>
  page.evaluate(
    async ([m, p, b, root]) => (await fetch(root + p, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined })).json(),
    [method, path, body ?? null, base],
  );
const state = () =>
  page.evaluate(() => ({
    paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
    font: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim().split(",")[0],
    cursor: document.documentElement.dataset.cursor,
    weather: document.querySelector("canvas[data-weather]")?.getAttribute("data-weather") ?? "none",
    scope: document.querySelector("[data-look-scope]")?.getAttribute("data-look-scope") ?? null,
    nav: document.querySelector("[data-nav-scope]")?.textContent ?? null,
  }));
const chip = (name) => page.locator("[data-look-scope] button", { hasText: name }).first();

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const original = (await api("GET", "/api/layouts")).active;
const made = [];
const report = {};
try {
  const blank = { canvas: { w: 1280, h: 620 }, grid: 8, snap: true, wallpaper: null, items: [{ id: "clock", kind: "clock", x: 40, y: 40, w: 380, h: 124, r: 0, z: 1, style: {}, props: {} }] };
  const a = await api("POST", "/api/layouts", { name: "Look A", data: blank });
  const b = await api("POST", "/api/layouts", { name: "Look B", data: blank });
  made.push(a.id, b.id);
  await api("PUT", `/api/layouts/active/${a.id}`);
  await page.goto(`${base}/?desk=${a.id}#/settings`, { waitUntil: "load" });
  await page.waitForSelector("[data-look-scope]", { timeout: 30000 });
  report.start = await state();

  await page.locator("[data-look-scope] button", { hasText: "its own look" }).click();
  await page.waitForTimeout(300);
  await page.locator("#appearance button", { hasText: "Washi paper" }).click();
  await page.locator("button[aria-label='Weather']").click();
  await page.locator("[role='menuitem']", { hasText: "Rain" }).click();
  await page.locator("#cursor button", { hasText: "Cross" }).click();
  await page.waitForTimeout(900);
  report.aOwn = await state();
  await page.screenshot({ path: `${out}/desk-looks-settings-a.png` });

  await chip("Look B").click();
  await page.waitForTimeout(900);
  report.bShared = await state();

  await chip("Look A").click();
  await page.waitForTimeout(900);
  report.aAgain = await state();

  await page.waitForTimeout(900);
  const saved = (await api("GET", "/api/layouts")).layouts;
  const la = saved.find((l) => l.id === a.id)?.data.look;
  const lb = saved.find((l) => l.id === b.id)?.data.look;
  report.server = { aPreset: la?.preset ?? null, aWeather: la?.fx?.particles ?? null, aCursor: la?.fx?.cursor ?? null, bHasLook: !!lb };

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-look-scope]", { timeout: 30000 });
  await page.waitForTimeout(800);
  report.afterReload = await state();

  await page.locator("nav[aria-label='Main'] a[aria-label='Desk']").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/desk-looks-desk-a.png` });
  await page.locator("button", { hasText: "arrange" }).first().click();
  await page.waitForTimeout(500);
  await page.locator("aside button", { hasText: /^desk$/ }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/desk-looks-panel.png` });
  report.panelHasLook = (await page.locator("button[aria-label='Kumo look for this desk']").count()) > 0;
  await page.keyboard.press("Escape");

  await page.goto(`${base}/?desk=${b.id}#/`, { waitUntil: "load" });
  await api("PUT", `/api/layouts/active/${b.id}`);
  await page.goto(`${base}/?desk=${b.id}#/`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.locator("button", { hasText: "arrange" }).first().click();
  await page.waitForTimeout(500);
  await page.locator("aside button", { hasText: /^desk$/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator("button[aria-label='Kumo look for this desk']").click();
  await page.waitForTimeout(900);
  report.bKumo = await state();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${out}/desk-looks-desk-b.png` });

  await page.goto(`${base}/#/settings`, { waitUntil: "load" });
  await page.waitForSelector("[data-look-scope]", { timeout: 30000 });
  await chip("Look A").click();
  await page.waitForTimeout(700);
  await page.locator("[data-look-scope] button", { hasText: "Back to the shared look" }).click();
  await page.waitForTimeout(1200);
  report.aBackToShared = await state();
  const final = (await api("GET", "/api/layouts")).layouts;
  report.serverAfter = { aHasLook: !!final.find((l) => l.id === a.id)?.data.look, bPreset: final.find((l) => l.id === b.id)?.data.look?.preset ?? null };
} finally {
  if (original) await api("PUT", `/api/layouts/active/${original}`);
  for (const id of made) await api("DELETE", `/api/layouts/${id}`);
}
const after = await api("GET", "/api/layouts");
report.restored = { active: after.active, layouts: after.layouts.map((l) => l.name) };
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
