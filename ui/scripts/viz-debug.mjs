import { chromium } from "playwright";
const base = "http://127.0.0.1:8766";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { vizStyle: "smoke", systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
});
await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await page.locator("main button[aria-label='Play']:not([disabled])").first().click({ force: true });
await page.waitForTimeout(2500);
await page.locator("button[aria-label='Open Now Playing']:visible").first().click();
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")];
  return canvases.map((c) => {
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) lit++;
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, lit, color: getComputedStyle(c).color, prefs: localStorage.getItem("cd-prefs")?.slice(0, 120) };
  });
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
