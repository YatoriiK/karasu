import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

// The player's heart asks the engine, so a stale "not liked" copy of a liked song still shows liked.
// Liking a song shows it in Liked Songs right away, before the save to Spotify finishes.
// Needs the sandbox rows: saved 'liketest', dz_tracks 4242 'Tab Test'.
const base = process.env.KARASU_URL || "http://127.0.0.1:8768";
const json = (path, init) => fetch(base + path, init).then((r) => r.json());
for (let i = 0; i < 90; i++) {
  try {
    if ((await json("/api/health")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
await fetch(`${base}/api/setup/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const report = { endpoint: await json("/api/liked?ids=sp:liketest,sp:nope,dz:4242") };

const stale = {
  id: "sp:liketest", dz_id: null, sp_id: "liketest", sp_uri: "spotify:track:liketest", title: "Heart Test",
  artist: { name: "Nobody", key: "nobody", dz_id: null }, album: { title: "Tests", dz_id: null }, year: null, year_source: null,
  duration_s: 180, art: null, has_preview: false, facets: { energy: null, tempo: null, top: [], genres: [] },
  popularity: { fans: null, tier: null }, state: { liked: false, disliked: false, hidden: false, saved: false }, reasons: [], score: null,
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 777 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.route("**/api/spotify/status", (r) => r.fulfill({ json: { configured: true, logged_in: true, missing_scopes: [], login_running: false, login_error: null, login_url: null, user: {} } }));
const slow = (body) => async (r) => {
  await new Promise((res) => setTimeout(res, 4000));
  await r.fulfill({ json: body });
};
await page.route("**/api/feedback", slow({ ok: true }));
await page.route("**/api/library/save", slow({ ok: true, sp_id: "tabtest" }));
await page.addInitScript((t) => {
  localStorage.setItem("cd-player", JSON.stringify({ state: { queue: [t], index: 0, volume: 0.8, muted: false, shuffle: false, repeat: "off", source: "spotify" }, version: 0 }));
}, stale);
try {
  await page.goto(`${base}/#/library`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const heart = page.locator("footer, [data-player-bar]").getByRole("button", { name: /^(Like|Unlike)$/ }).first();
  const anyHeart = (await heart.count()) ? heart : page.getByRole("button", { name: "Unlike" }).first();
  report.playerHeartShowsLiked = (await anyHeart.getAttribute("aria-pressed")) === "true";
  report.libraryBefore = await page.getByText("Tab Test").count();

  await page.goto(`${base}/#/track/dz:4242`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Like", exact: true }).first().click();
  await page.goto(`${base}/#/library`, { waitUntil: "load" });
  await page.getByText("Your Library").first().waitFor({ timeout: 5000 });
  await page.getByRole("heading", { name: "Tab Test" }).waitFor({ state: "detached", timeout: 5000 });
  const row = page.locator("main, [role=main], body").getByText("Tab Test", { exact: true });
  const shown = await row.first().waitFor({ timeout: 2500 }).then(() => true, () => false);
  const ms = Date.now() - t0;
  report.libraryShowsLikeIn = shown && ms < 4000 ? `${ms} ms (the save takes 4 s)` : shown ? `${ms} ms, only after the save` : "not shown";
  await page.screenshot({ path: `${SHOTS}/liked-state.png`, clip: { x: 0, y: 0, width: 1320, height: 777 } });
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
process.exit(0);
