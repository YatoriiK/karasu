import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const out = {};
for (const source of ["preview", "spotify"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript((src) => {
    localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false }, version: 0 }));
    localStorage.setItem("cd-player", JSON.stringify({ state: { source: src }, version: 0 }));
  }, source);
  await page.goto(`${base}/#/library`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const rows = page.locator("main [aria-label='Play'], main [aria-label='Pause']");
  out[source] = {
    badges: await page.getByText("No preview", { exact: true }).count(),
    playButtons: await rows.count(),
    disabled: await page.locator("main button[aria-label='Play'][disabled]").count(),
  };
  await page.close();
}
console.log(JSON.stringify(out));
await browser.close();
