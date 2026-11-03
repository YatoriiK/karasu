import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) => route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("karasu-look", JSON.stringify({ state: { look: { fx: { scene: "ridges", cursor: "image", cursorTrail: "ink" } }, preset: null, saved: [] }, version: 1 }));
});
await page.goto(`${base}/#/settings`, { waitUntil: "load" });
await page.waitForSelector("#effects", { timeout: 30000 });
for (const id of ["effects", "cursor"]) {
  await page.locator(`nav[aria-label='Settings sections']:visible a[href='#${id}']`).click();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${out}/settings-${id}.png` });
}
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
