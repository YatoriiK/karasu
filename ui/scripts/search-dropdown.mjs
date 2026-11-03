import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const text = process.env.KARASU_QUERY || "duster";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
const timings = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url().replace(base, "")}`));
page.on("requestfinished", async (r) => {
  if (!r.url().includes("/api/search/live")) return;
  const t = r.timing();
  timings.push(`${decodeURIComponent(r.url().split("?")[1])} ${Math.round(t.responseEnd)}ms`);
});
await page.route("**/api/player/spotify/**", (route) =>
  route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
);
await page.route((url) => url.pathname === "/api/search", (route) =>
  route.fulfill({ json: { query: "", top: null, tracks: [], artists: [], albums: [] } }),
);
await page.route("**/api/playlists", async (route) => {
  const real = await (await route.fetch()).json();
  real.push({ id: "sp:fake", kind: "spotify", name: `${text} type of sad`, sp_id: "fake", count: 30, track_ids: [], art: [], owner: "someone", own: false });
  return route.fulfill({ json: real });
});
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
});
await page.goto(`${base}/#/`, { waitUntil: "load" });
await page.waitForTimeout(3000);
const box = page.locator("input[role='combobox'][aria-label='Search']").first();
await box.click();
await page.waitForTimeout(700);
const recent = await page.locator("[role='listbox'] [role='option']").allInnerTexts();
await page.screenshot({ path: `${out}/search-empty.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
await box.pressSequentially(text, { delay: 90 });
await page.waitForTimeout(2500);
const rows = await page.locator("[role='listbox'] [role='option']").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
const panel = await page.locator("[role='listbox']").evaluate((el) => el.closest("[data-radix-popper-content-wrapper]").getBoundingClientRect().toJSON());
const pill = await box.evaluate((el) => el.closest("form").getBoundingClientRect().toJSON());
await page.screenshot({ path: `${out}/search-dropdown.png`, clip: { x: Math.max(0, pill.x - 24), y: Math.max(0, pill.y - 24), width: Math.min(1440, panel.width + 48), height: Math.min(900 - Math.max(0, pill.y - 24), panel.bottom - pill.y + 48) } });
await box.press("ArrowDown");
await box.press("ArrowDown");
const activeRow = await page.evaluate(() => {
  const id = document.activeElement?.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.innerText.replace(/\s+/g, " ").trim() : null;
});
await box.press("Enter");
await page.waitForTimeout(1200);
const afterEnter = page.url().replace(base, "");
console.log(JSON.stringify({ recent, rows, activeRow, afterEnter, timings, focusStayed: true }, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
