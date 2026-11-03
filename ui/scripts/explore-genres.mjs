import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const genre = process.env.KARASU_GENRE || "slowcore";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && !r.url().includes("/api/art/") && problems.push(`${r.status()} ${r.url().replace(base, "")}`));
  await page.route("**/api/player/spotify/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
    localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
  });
  return page;
}

const scrollTo = (page, y) => page.locator("main .scroll-area").first().evaluate((el, top) => el.scrollTo({ top, behavior: "instant" }), y);
const texts = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));

const page = await open(1440, 900);
await page.goto(`${base}/#/explore`, { waitUntil: "load" });
await page.waitForSelector("a[href*='/explore/genre/']", { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/explore-1.png` });
const forYou = await texts(page, "a[href*='/explore/genre/']");
const browse = page.locator("h2", { hasText: "Browse every genre" });
let families = [];
if (await browse.count()) {
  await browse.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const chips = page.locator("section", { has: browse }).locator("button");
  families = await chips.allInnerTexts();
  if ((await chips.count()) > 1) await chips.nth(1).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/explore-2.png` });
}

for (const [name, key] of [["genre", genre], ["riffs", "riffs"]]) {
  await page.goto(`${base}/#/explore/genre/${key}`, { waitUntil: "load" });
  await page.waitForSelector("main h2", { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-1.png` });
  await scrollTo(page, 900);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-2.png` });
  await scrollTo(page, 1900);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-3.png` });
  const heads = await texts(page, "main h2");
  const title = await page.locator("header h1").first().innerText();
  console.log(JSON.stringify({ page: key, title, sections: heads.slice(0, 12) }));
}

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/feed-1.png` });

const phone = await open(390, 844);
await phone.goto(`${base}/#/explore/genre/riffs`, { waitUntil: "load" });
await phone.waitForSelector("main h2", { timeout: 90000 });
await phone.waitForTimeout(2000);
await phone.screenshot({ path: `${out}/riffs-phone.png` });
await phone.goto(`${base}/#/explore`, { waitUntil: "load" });
await phone.waitForSelector("a[href*='/explore/genre/']", { timeout: 90000 });
await phone.waitForTimeout(2000);
await phone.screenshot({ path: `${out}/explore-phone.png` });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

console.log(JSON.stringify({ forYou: forYou.slice(0, 14), families, overflow }, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
