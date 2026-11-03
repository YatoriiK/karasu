import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const out = SHOTS;
let browser;
for (let i = 0; i < 60 && !browser; i++) {
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const page = browser.contexts()[0].pages()[0];
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("requestfailed", (r) => problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
for (let i = 0; i < 60; i++) {
  if (await page.locator('[data-desk-item="clock"]').count()) break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/app-desk.png` });
console.log("title:", await page.title(), "| items:", await page.locator("[data-desk-item]").count());
await page.evaluate(() => { window.location.hash = "#/settings"; });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/app-settings.png` });
await page.evaluate(() => { window.location.hash = "#/"; });
await page.waitForTimeout(800);
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
