import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const base = process.env.KARASU_URL || "http://127.0.0.1:8765";
const out = SHOTS;
const [route = "/#/", name = "page", steps = "3", width = "1440", height = "900", wait = "3000"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(base + route, { waitUntil: "load", timeout: 30000 }).catch((e) => problems.push(`goto: ${e.message}`));
await page.waitForTimeout(+wait);
for (let i = 0; i < +steps; i++) {
  if (i > 0) {
    await page.evaluate((h) => {
      const els = [...document.querySelectorAll(".scroll-area, main, .overflow-y-auto, .overflow-auto")];
      const el = els.find((e) => e.scrollHeight > e.clientHeight + 10) ?? document.scrollingElement;
      el.scrollBy({ top: h * 0.8 });
    }, +height);
    await page.waitForTimeout(1300);
  }
  await page.screenshot({ path: `${out}/${name}-${i}.png` });
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no console errors");
