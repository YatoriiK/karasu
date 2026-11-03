import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) =>
  route.fulfill({ json: route.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }),
);
await page.addInitScript(() => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "preview" }, version: 0 }));
});
const report = {};
const menuText = async () => (await page.locator("[role='menu']").last().innerText()).split("\n").filter(Boolean).slice(0, 6).join(" | ");
const close = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
};

await page.goto(`${base}/#/explore/genre/slowcore`, { waitUntil: "load" });
await page.waitForSelector("main h2", { timeout: 90000 });
await page.locator("main [class*='grid items-center']").first().dblclick();
await page.waitForTimeout(2000);

await page.locator("button[aria-label='Queue']").click();
await page.waitForTimeout(600);
const queued = page.locator("aside button[aria-label='Drag to reorder']").first();
await queued.locator("xpath=..").click({ button: "right" });
await page.waitForTimeout(400);
report.queue = await menuText();
await page.screenshot({ path: `${out}/menu-queue.png` });
await close();
await page.locator("aside button[aria-label='Close queue']").click();

const track = await page.evaluate(() => JSON.parse(localStorage.getItem("cd-player") || "{}").state?.queue?.[0]?.id);
await page.goto(`${base}/#/track/${encodeURIComponent(track)}`, { waitUntil: "load" });
await page.waitForSelector("main button[aria-label='More']", { timeout: 60000 });
await page.locator("main button[aria-label='More']").first().click();
await page.waitForTimeout(400);
report.trackMore = await menuText();
await close();
await page.locator("main h1").first().click({ button: "right" });
await page.waitForTimeout(400);
report.trackHero = await menuText();
await page.locator("[role='menuitem']", { hasText: "Copy song link" }).click();
await page.waitForTimeout(1200);
report.clipboard = await page.evaluate(() => navigator.clipboard.readText());

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(3000);
const gem = page.getByText("Hidden gem", { exact: true }).first();
if (await gem.count()) {
  await gem.scrollIntoViewIfNeeded();
  await gem.click({ button: "right" });
  await page.waitForTimeout(400);
  report.homeGem = await menuText();
  await close();
} else report.homeGem = "no gem tile on this home";

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
