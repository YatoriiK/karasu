import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) => route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.goto(`${base}/#/feed`, { waitUntil: "load" });
const asset = (await page.evaluate(async (root) => (await fetch(`${root}/api/assets`)).json(), base)).find((a) => !a.video)?.id;
await page.evaluate((id) => {
  localStorage.clear();
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false, clock24: true, clockDate: false, npArt: "vinyl", density: "compact", playerStyle: "docked", visualizer: false, vizStyle: "bars", motion: "full" }, version: 0 }));
  localStorage.setItem("karasu-skins", JSON.stringify({ state: { skins: { "nav.desk": { asset: id, mode: "ink" } } }, version: 2 }));
  localStorage.setItem("karasu-look", JSON.stringify({ state: { look: { scheme: "light", paper: "#c9c5b9", surface: "#c9c5b9", ink: "#191817", radius: 0, fx: { particles: "snow" } }, preset: "washi", saved: [{ id: "x1", name: "Old saved", look: { paper: "#123456" } }] }, version: 1 }));
}, asset);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2500);
const result = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("karasu-look"));
  const root = getComputedStyle(document.documentElement);
  return {
    version: s.version,
    paper: root.getPropertyValue("--paper").trim(),
    sharedFx: s.state.shared.fx,
    preset: s.state.shared.preset,
    skins: Object.keys(s.state.shared.skins ?? {}),
    saved: s.state.saved.map((x) => x.name),
    weather: document.querySelector("canvas[data-weather]")?.getAttribute("data-weather") ?? "none",
    clock: document.querySelector("header")?.textContent?.match(/\d{1,2}:\d{2}( [AP]M)?/)?.[0] ?? null,
    dockSkin: !!document.querySelector("nav[aria-label='Main'] a[aria-label='Desk'] span[aria-hidden]"),
  };
});
console.log(JSON.stringify({ asset, ...result }, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
