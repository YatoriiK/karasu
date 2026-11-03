import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const report = {};

for (const [label, width] of [["wide", 1440], ["narrow", 980]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`${label} console: ${m.text()}`));
  await page.route("**/api/player/spotify/**", (route) => route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
  await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 })));
  await page.goto(`${base}/#/settings`, { waitUntil: "load" });
  await page.waitForSelector("#effects", { timeout: 30000 });
  await page.waitForTimeout(800);
  const nav = page.locator("nav[aria-label='Settings sections']:visible");
  const links = nav.locator("a");
  const boxes = await links.evaluateAll((els) => els.map((el) => ({ text: el.textContent, ...el.getBoundingClientRect().toJSON() })));
  const viewport = page.viewportSize();
  report[label] = {
    links: boxes.length,
    cutOff: boxes.filter((b) => b.right > viewport.width - 4 || b.left < 0 || b.bottom > viewport.height || b.width === 0).map((b) => b.text),
  };
  await page.screenshot({ path: `${out}/settings-nav-${label}.png` });
  await links.filter({ hasText: "Cursor" }).click();
  await page.waitForTimeout(1500);
  report[label].afterClick = {
    current: await nav.locator("a[aria-current='true']").allTextContents(),
    cursorTop: Math.round(await page.locator("#cursor").evaluate((el) => el.getBoundingClientRect().top)),
  };
  await page.screenshot({ path: `${out}/settings-nav-${label}-cursor.png` });
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
