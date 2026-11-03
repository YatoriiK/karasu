import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const out = SHOTS;
let browser;
for (let i = 0; i < 60; i++) {
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!browser) {
  console.log("could not connect to WebView2");
  process.exit(1);
}
const context = browser.contexts()[0];
const page = context.pages()[0];
console.log("url:", page.url());
for (let i = 0; i < 90; i++) {
  const text = await page.locator("body").innerText().catch(() => "");
  if (/Good (morning|afternoon|evening)|Up late/.test(text)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/app-home.png` });
const errors = await page.evaluate(() => (window.__errors || []).slice(0, 5));
console.log("titlebar:", await page.locator("button[aria-label='Minimize']").count(), "errors:", errors);
await browser.close();
