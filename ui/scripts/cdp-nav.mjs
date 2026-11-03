import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const out = SHOTS;
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
for (const [name, hash, wait] of [["settings", "#/settings", 2500], ["library", "#/library", 3000], ["profile", "#/profile", 7000], ["daily", "#/playlist/daily%3Amix", 3000], ["home-today", "#/", 3000]]) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(wait);
  if (name === "home-today") {
    await page.evaluate(() => document.querySelector(".scroll-area")?.scrollBy({ top: 760 }));
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${out}/app-${name}.png` });
}
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
