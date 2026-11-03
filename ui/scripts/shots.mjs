import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.KARASU_URL || "http://127.0.0.1:8765";
const out = SHOTS;
const only = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const routes = [
  ["home", "/#/"],
  ["feed", "/#/feed"],
  ["playlists", "/#/playlists"],
  ["playlist-fresh", "/#/playlist/lane%3Afresh"],
  ["library", "/#/library"],
  ["search", "/#/search?q=duster"],
  ["vibe", "/#/search?q=dreamy%20slowcore%20with%20soft%20guitar&vibe=1"],
  ["settings", "/#/settings"],
  ["discover", "/#/discover"],
  ["explore", "/#/explore"],
  ["stats", "/#/stats"],
  ["profile", "/#/profile"],
  ["history", "/#/history"],
  ["track", "/#/track/dz%3A90218351"],
  ["artist", "/#/artist/6306014"],
  ["album", "/#/album/533909672"],
  ["studio", "/#/studio"],
  ["daily", "/#/playlist/daily%3Amix"],
].filter(([name]) => !only.length || only.includes(name));

const viewports = [
  { tag: "desktop", width: 1440, height: 900 },
  ...(process.env.KARASU_MOBILE === "0" ? [] : [{ tag: "mobile", width: 390, height: 844 }]),
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  if (process.env.KARASU_THEME) {
    await page.addInitScript((theme) => {
      localStorage.setItem("cd-prefs", JSON.stringify({ state: { theme }, version: 0 }));
    }, process.env.KARASU_THEME);
  }
  page.on("console", (m) => m.type() === "error" && problems.push(`[${vp.tag}] console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[${vp.tag}] pageerror: ${e.message}`));
  for (const [name, path] of routes) {
    await page.goto(base + path, { waitUntil: "load", timeout: 30000 }).catch((e) => problems.push(`goto ${name}: ${e.message}`));
    await page.waitForTimeout({ vibe: 9000, profile: 8000, explore: 5000, stats: 3500, home: 6000 }[name] ?? 2200);
    await page.screenshot({ path: `${out}/${vp.tag}${process.env.KARASU_THEME ? "-" + process.env.KARASU_THEME : ""}-${name}.png` });
  }
  if (vp.tag === "desktop" && (!only.length || only.includes("extras"))) {
    await page.goto(base + "/#/feed", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    await page.waitForTimeout(1500);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("dust", { delay: 40 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${vp.tag}-palette.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const play = page.locator("main button[aria-label='Play']:not([disabled])").first();
    if (await play.count()) {
      await play.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${out}/${vp.tag}-playing.png` });
      await page.locator("button[aria-label='Open Now Playing']:visible").first().click().catch((e) => problems.push(`open now playing: ${String(e.message).slice(0, 160)}`));
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${out}/${vp.tag}-nowplaying.png` });
    }
  }
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no console errors");
