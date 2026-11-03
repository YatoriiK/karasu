import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url().replace(base, "")}`));
  await page.route("**/api/player/spotify/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
    localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
  });
  return page;
}

const scroller = (page) => page.locator("main .scroll-area").first();
const scrollTo = (page, y) => scroller(page).evaluate((el, top) => el.scrollTo({ top, behavior: "instant" }), y);

const page = await open(1440, 900);
await page.goto(`${base}/#/profile`, { waitUntil: "load" });
await page.waitForSelector("text=Top artists this month", { timeout: 30000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/profile-1.png` });
await scrollTo(page, 560);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/profile-2.png` });
await scrollTo(page, 5000);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/profile-3.png` });
const hero = await page.locator("header h1").first().innerText();
const meta = await page.locator("header").first().innerText();

await page.goto(`${base}/#/stats`, { waitUntil: "load" });
await page.waitForSelector("text=Where they listen", { timeout: 30000 });
const card = page.locator("section", { has: page.locator("h2", { hasText: "Where they listen" }) }).last();
await card.scrollIntoViewIfNeeded();
const t0 = Date.now();
await card.locator("ol li").first().waitFor({ timeout: 60000 });
const firstLoad = Date.now() - t0;
await page.waitForTimeout(2200);
await card.screenshot({ path: `${out}/stats-globe.png` });
const cities = await card.locator("ol li").allInnerTexts();
const globe = card.locator("canvas");
const gb = await globe.boundingBox();
await page.mouse.move(gb.x + gb.width * 0.5, gb.y + gb.height * 0.5);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width * 0.75, gb.y + gb.height * 0.45, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(700);
await globe.screenshot({ path: `${out}/stats-globe-dragged.png` });
await card.locator("ol li button").nth(2).hover();
await page.waitForTimeout(400);
await card.locator("ol li button").nth(2).click();
await page.waitForTimeout(1700);
await globe.screenshot({ path: `${out}/stats-globe-city3.png` });
const longTasks = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const seen = [];
      const po = new PerformanceObserver((list) => list.getEntries().forEach((e) => seen.push(Math.round(e.duration))));
      po.observe({ type: "longtask", buffered: false });
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < 3000) requestAnimationFrame(tick);
        else {
          po.disconnect();
          resolve({ fps: Math.round(frames / 3), longTasks: seen });
        }
      };
      requestAnimationFrame(tick);
    }),
);
const search = card.locator("input");
await search.click();
await search.pressSequentially("mac demarco", { delay: 60 });
await page.waitForTimeout(2500);
const options = await card.locator("[role='option']").allInnerTexts();
const songIndex = options.findIndex((o) => o.includes("Song"));
if (songIndex >= 0) await card.locator("[role='option']").nth(songIndex).click();
else await search.press("Enter");
await card.locator("text=Spotify shares listener cities per artist").waitFor({ timeout: 60000 }).catch(() => problems.push("song note missing"));
await card.locator("ol li").first().waitFor({ timeout: 60000 }).catch(() => problems.push("song cities missing"));
await page.waitForTimeout(1800);
await card.screenshot({ path: `${out}/stats-globe-song.png` });
const songPanel = (await card.innerText()).split("\n").slice(0, 40).join(" | ");

await scrollTo(page, 0);
await page.screenshot({ path: `${out}/stats-top.png` });
await page.goto(`${base}/#/stats?tab=taste`, { waitUntil: "load" });
await page.waitForSelector("text=Your music personality", { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/stats-taste.png` });

const phone = await open(390, 844);
await phone.goto(`${base}/#/profile`, { waitUntil: "load" });
await phone.waitForSelector("text=Top artists this month", { timeout: 30000 });
await phone.waitForTimeout(1500);
await phone.screenshot({ path: `${out}/profile-phone.png` });
await phone.goto(`${base}/#/stats`, { waitUntil: "load" });
const phoneCard = phone.locator("section", { has: phone.locator("h2", { hasText: "Where they listen" }) }).last();
await phoneCard.scrollIntoViewIfNeeded();
await phoneCard.locator("ol li").first().waitFor({ timeout: 60000 }).catch(() => problems.push("phone cities missing"));
await phone.waitForTimeout(1500);
await phoneCard.screenshot({ path: `${out}/stats-globe-phone.png` });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

console.log(JSON.stringify({ hero, meta: meta.replace(/\s+/g, " ").slice(0, 200), firstLoad, cities, longTasks, options, songPanel, overflow }, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
