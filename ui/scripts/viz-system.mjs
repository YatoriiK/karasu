import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const problems = [];
for (const style of ["bars", "smoke", "memo", "mirror", "wave"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript((s) => {
    localStorage.setItem("cd-prefs", JSON.stringify({ state: { vizStyle: s, systemAudio: true, launchSpotify: false, fullSongs: false }, version: 0 }));
    localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
  }, style);
  await page.goto(`${base}/#/feed`, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  await page.locator("main button[aria-label='Play']:not([disabled])").first().click({ force: true });
  await page.waitForTimeout(2000);
  await page.locator("button[aria-label='Open Now Playing']:visible").first().click();
  await page.waitForTimeout(1200);
  await page.locator("[class*='z-[60]'] button[aria-label='Pause']").first().click();
  await page.waitForTimeout(300);
  const paused = await page.locator("[class*='z-[60]'] button[aria-label='Play']").count();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/viz-sys-${style}.png`, clip: { x: 240, y: 560, width: 960, height: 240 } });
  if (!paused) problems.push(`${style}: preview still playing`);
  await page.close();
}
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
