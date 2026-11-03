import { ROOT } from "./paths.mjs";
import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const result = [];
await page.evaluate(() => { window.location.hash = "#/library"; });
await page.waitForTimeout(3000);
for (const top of [3000, 12000, 30000, 60000]) {
  await page.evaluate((t) => document.querySelector("main .scroll-area")?.scrollTo({ top: t }), top);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const sc = document.querySelector("main .scroll-area");
    const box = sc.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-index]")];
    const visible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.top && b.top < box.bottom; });
    return { scrollTop: Math.round(sc.scrollTop), height: sc.scrollHeight, mounted: rows.length, visible: visible.length, first: visible[0]?.getAttribute("data-index") };
  });
  result.push(info);
}
await page.screenshot({ path: `${ROOT}/cache/shots/app-library-deep.png` });
console.log(JSON.stringify(result));
await browser.close();
