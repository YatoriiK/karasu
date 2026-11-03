import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const base = process.env.KARASU_URL || "http://127.0.0.1:8765";
const out = SHOTS;
const [preset = "Washi paper", ...routes] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(`${base}/#/settings`, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.locator("button", { hasText: preset }).first().click();
await page.waitForTimeout(800);
const tag = preset.split(" ")[0].toLowerCase();
for (const route of routes.length ? routes : ["/", "/discover", "/settings"]) {
  await page.goto(`${base}/#${route}`, { waitUntil: "load" });
  await page.waitForTimeout(route === "/" ? 5000 : 2500);
  const name = route === "/" ? "desk" : route.split("/")[1];
  await page.screenshot({ path: `${out}/look-${tag}-${name}.png` });
}
await page.goto(`${base}/#/settings`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator("button", { hasText: "Sumi night" }).first().click();
await page.waitForTimeout(500);
console.log(problems.length ? problems.join("\n") : "no console errors");
await browser.close();
