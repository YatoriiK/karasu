import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const base = process.env.CD_URL || "http://127.0.0.1:8765";
const out = SHOTS;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(e.message));

await page.goto(`${base}/#/discover/mood?seed=late_night&label=Late%20night`, { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/desktop-discover-mood.png` });
await page.goto(`${base}/#/discover/instrumental?seed=saxophone&label=Saxophone`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/desktop-discover-instrument.png`, fullPage: false });

await page.goto(`${base}/#/studio`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByPlaceholder("Add a song, artist or album…").fill("duster");
await page.waitForTimeout(1500);
await page.locator("[cmdk-item]").first().click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Build" }).click();
await page.getByRole("button", { name: "Generate playlist" }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/desktop-studio.png` });
const rows = await page.locator("[aria-label='Replace this song']").count();
console.log("studio rows:", rows);
console.log(problems.length ? problems.join("\n") : "no console errors");
await browser.close();
