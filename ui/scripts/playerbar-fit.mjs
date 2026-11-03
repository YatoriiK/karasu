import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const setup = await browser.newPage();
await setup.goto(`${base}/#/feed`, { waitUntil: "load" });
const track = await setup.evaluate(async () => {
  const home = await (await fetch("/api/home")).json();
  let found = null;
  const walk = (x) => {
    if (found || !x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (x.dz_id && x.title && x.artist && x.sp_id) found = x;
    Object.values(x).forEach(walk);
  };
  walk(home);
  return found;
});
await setup.close();
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 720], [1920, 1080]]) {
  for (const source of ["spotify", "preview"]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await page.route("**/api/player/spotify/**", (route) =>
      route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
    );
    await page.addInitScript(
      ([t, src]) => {
        localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
        localStorage.setItem("cd-player", JSON.stringify({ state: { source: src, queue: [t], index: 0, order: [0], deviceName: "YATO" }, version: 0 }));
      },
      [track, source],
    );
    await page.goto(`${base}/#/feed`, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    const fit = await page.evaluate(() => {
      const bar = document.querySelector("button[aria-label='Open Now Playing']")?.closest("[class*='grid-cols']");
      if (!bar) return { missing: true };
      const cols = [...bar.children].map((c) => ({ w: Math.round(c.getBoundingClientRect().width), scroll: c.scrollWidth, client: c.clientWidth }));
      const right = bar.children[2];
      const clipped = [...right.querySelectorAll("*")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible").map((el) => el.textContent?.trim().slice(0, 20));
      const items = [...right.children].map((c) => Math.round(c.getBoundingClientRect().width));
      const r = right.getBoundingClientRect();
      const c = bar.children[1].getBoundingClientRect();
      return { cols, items, clipped, overlap: Math.round(c.right - r.left), pill: right.querySelector("button[aria-label^='Playing on']")?.textContent ?? null };
    });
    const box = await page.locator("button[aria-label='Open Now Playing']").first().evaluate((el) => el.closest("[class*='grid-cols']").getBoundingClientRect().toJSON());
    await page.screenshot({ path: `${out}/playerbar-${source}-${w}.png`, clip: { x: box.x + box.width * 0.55, y: box.y - 4, width: box.width * 0.45 + 4, height: box.height + 8 } });
    console.log(`${w}x${h} ${source}:`, JSON.stringify(fit));
    await page.close();
  }
}
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
