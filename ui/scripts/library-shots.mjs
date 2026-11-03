import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(`${base}/#/library`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/lib-liked.png` });
await page.getByRole("radio", { name: "Playlists" }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/lib-playlists.png` });
for (const [name, id] of [["own", "sp%3A2Lz8HWdrjFxN3X9Bi6NVic"], ["followed", "sp%3A6rSK2M0IHX2A4Poe6J5HMI"]]) {
  await page.goto(`${base}/#/playlist/${id}`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/pl-${name}.png` });
}
console.log(problems.length ? problems.join("\n") : "no console errors");
await browser.close();
