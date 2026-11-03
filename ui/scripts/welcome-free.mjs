import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8767";
const out = SHOTS;
const picks = (process.env.PICKS || "Mitski,Radiohead,Nujabes").split(",");
const report = {};

for (let i = 0; i < 120; i++) {
  try {
    if ((await (await fetch(`${base}/api/health`)).json()).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
const before = await (await fetch(`${base}/api/setup`)).json();
report.before = { needed: before.needed, done: before.done, library: before.library };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) => route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 })));

await page.goto(`${base}/#/`, { waitUntil: "load" });
await page.waitForURL(/#\/welcome/, { timeout: 30000 });
report.redirected = page.url();
await page.waitForSelector("[data-choice=free]");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/welcome-choose.png` });

await page.click("[data-choice=free]");
await page.waitForSelector("[data-artist-grid] button", { timeout: 30000 });
await page.waitForTimeout(800);
report.popular = await page.locator("[data-artist-grid] button").count();
await page.screenshot({ path: `${out}/welcome-artists.png` });

for (const name of picks) {
  await page.fill("input[aria-label='Search artists']", name);
  await page.waitForFunction((n) => document.body.innerText.toLowerCase().includes(`results for “${n.toLowerCase()}”`), name, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator("[data-artist-grid] button", { hasText: name }).first().click();
  await page.waitForTimeout(200);
}
report.picked = await page.locator("[data-picked] button[title^='Remove']").allInnerTexts();
await page.screenshot({ path: `${out}/welcome-picked.png` });

const started = Date.now();
await page.click("button:has-text('Learn my taste')");
await page.waitForSelector("[data-setup-job]", { timeout: 30000 });
await page.waitForTimeout(4000);
await page.locator("[data-picked]").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/welcome-learning.png` });
await page.waitForSelector("[data-setup-job=done], [data-setup-job=error]", { timeout: 20 * 60_000 });
report.learnSeconds = Math.round((Date.now() - started) / 1000);
report.jobState = await page.getAttribute("[data-setup-job]", "data-setup-job");
report.jobText = (await page.locator("[data-setup-job]").innerText()).replace(/\s+/g, " ");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/welcome-learned.png` });

await page.click("button:has-text('Continue')");
await page.waitForSelector("[data-welcome=history]");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/welcome-history.png`, fullPage: false });
await page.click("[data-requested]");
await page.click("button:has-text('Finish')");
await page.waitForFunction(() => location.hash === "#/" || location.hash === "", null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/welcome-after.png` });

const after = await (await fetch(`${base}/api/setup`)).json();
report.after = { needed: after.needed, done: after.done, path: after.path, history_requested: after.history_requested, picks: after.picks.map((a) => a.name) };
const health = await (await fetch(`${base}/api/health`)).json();
report.corpus = health.corpus;
const home = await (await fetch(`${base}/api/home`)).json();
report.home = Object.fromEntries(
  Object.entries(home)
    .filter(([, v]) => v && typeof v === "object")
    .map(([k, v]) => [k, Array.isArray(v) ? v.length : Array.isArray(v.items) ? v.items.length : Array.isArray(v.tracks) ? v.tracks.length : "obj"]),
);
const similar = await (await fetch(`${base}/api/discover/similar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
report.discoverSimilar = { count: (similar.tracks ?? similar.items ?? []).length, sample: (similar.tracks ?? similar.items ?? []).slice(0, 5).map((t) => `${t.artist?.name} - ${t.title}`) };

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/welcome-feed.png` });

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
