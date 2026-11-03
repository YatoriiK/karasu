import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const results = {};
for (const systemAudio of [true, false]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript((sys) => {
    localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: sys, launchSpotify: false, fullSongs: false }, version: 0 }));
  }, systemAudio);
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForTimeout(4500);
  const canvas = page.locator(`[data-desk-item="visualizer"] canvas`).first();
  const frames = [];
  for (let i = 0; i < 6; i++) {
    frames.push(
      await canvas.evaluate((el) => {
        const ctx = el.getContext("2d");
        const d = ctx.getImageData(0, 0, el.width, el.height).data;
        let lit = 0;
        let sum = 0;
        for (let k = 3; k < d.length; k += 4) {
          if (d[k] > 8) lit++;
          sum = (sum * 31 + d[k]) % 1000000007;
        }
        return { lit, sum };
      }),
    );
    await page.waitForTimeout(250);
  }
  const changes = frames.slice(1).filter((f, i) => f.sum !== frames[i].sum).length;
  results[systemAudio ? "pcSound" : "silent"] = { changes, lit: frames.map((f) => f.lit) };
  const box = await page.locator(`[data-desk-item="visualizer"]`).first().boundingBox();
  if (box) await page.screenshot({ path: `${out}/viz-desk-${systemAudio ? "pc" : "silent"}.png`, clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 } });
  await page.close();
}
console.log(JSON.stringify(results));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
