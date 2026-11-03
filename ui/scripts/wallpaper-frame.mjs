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
const wallpaper = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll(".bg-paper > div > div")].find((d) => d.style.backgroundImage);
    const saved = JSON.parse(localStorage.getItem("karasu-look") ?? "{}").state?.shared?.wallpaper ?? {};
    return { size: el?.style.backgroundSize ?? null, position: el?.style.backgroundPosition ?? null, zoom: saved.zoom ?? 1, x: saved.x ?? null, y: saved.y ?? null };
  });

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(1000);
const assets = await api("GET", "/api/assets");
const tall = assets.filter((a) => !a.video && a.w && a.h).sort((a, b) => b.h / b.w - a.h / a.w)[0];
const original = (await api("GET", "/api/layouts")).active;
const report = { picture: { w: tall.w, h: tall.h } };
let made = null;
try {
  const desk = await api("POST", "/api/layouts", { name: "frame test", data: { canvas: { w: 1280, h: 620 }, grid: 8, snap: true, wallpaper: null, items: [] } });
  made = desk.id;
  await api("PUT", `/api/layouts/active/${desk.id}`);
  await page.evaluate((id) => {
    const wp = { asset: id, fit: "cover", position: "center", dim: 0, blur: 0, mono: false };
    localStorage.setItem("karasu-look", JSON.stringify({ state: { look: { scheme: "light", paper: "#f3f0e8", surface: "#fbf9f4", ink: "#141414", wallpaper: wp }, shared: { scheme: "light", paper: "#f3f0e8", surface: "#fbf9f4", ink: "#141414", wallpaper: wp } }, version: 2 }));
  }, tall.id);
  await page.goto(`${base}/?desk=${desk.id}#/`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  report.before = await wallpaper();
  await page.screenshot({ path: `${out}/wallpaper-before.png` });

  await page.goto(`${base}/?desk=${desk.id}#/settings`, { waitUntil: "load" });
  await page.waitForSelector("#wallpaper", { timeout: 30000 });
  await page.locator("nav[aria-label='Settings sections']:visible a[href='#wallpaper']").click();
  await page.waitForTimeout(1200);
  const framer = page.locator("#wallpaper [data-wallpaper-framer] > div").first();
  const box = await framer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
  report.zoomed = await wallpaper();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  report.dragged = await wallpaper();
  await page.locator("#wallpaper").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/wallpaper-settings.png` });

  await page.locator("nav[aria-label='Main'] a[aria-label='Desk']").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/wallpaper-after.png` });
  await page.locator("button", { hasText: "arrange" }).first().click();
  await page.waitForTimeout(400);
  await page.locator("aside button", { hasText: /^desk$/ }).first().click();
  await page.waitForTimeout(500);
  report.panelFramer = await page.locator("aside [data-wallpaper-framer]").count();
  await page.locator("aside [data-wallpaper-framer]").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/wallpaper-panel.png` });
} finally {
  if (original) await api("PUT", `/api/layouts/active/${original}`);
  if (made) await api("DELETE", `/api/layouts/${made}`);
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
