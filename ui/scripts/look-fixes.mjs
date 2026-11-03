import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const base = process.env.KARASU_URL || "http://127.0.0.1:8768";
const out = SHOTS;
const report = {};
await fetch(`${base}/api/setup/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const watch = (page, tag) => {
  page.on("pageerror", (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`${tag} console: ${m.text()}`));
};
const ink = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim());

// 1. Connecting Spotify from the setup guide turns full songs on by itself.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, "full-songs");
  let connected = false;
  await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
  await page.route("**/api/spotify/status", (r) =>
    r.fulfill({ json: { configured: true, logged_in: connected, missing_scopes: [], login_running: false, login_error: null, login_url: null, user: connected ? { name: "tester" } : null } }),
  );
  await page.route("**/api/spotify/login", (r) => {
    connected = true;
    return r.fulfill({ json: { started: true } });
  });
  await page.route("**/api/setup/sync", (r) => r.fulfill({ json: { job: null } }));
  await page.route("**/api/setup", async (r) => {
    if (r.request().method() !== "GET") return r.continue();
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, client_id: "0123456789abcdef0123456789abcdef", path: "premium", spotify: { ...real.spotify, configured: true, logged_in: connected } } });
  });
  await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: true }, version: 0 })));
  await page.goto(`${base}/#/welcome?step=connect&path=premium`, { waitUntil: "load" });
  await page.waitForSelector("[data-welcome=connect]", { timeout: 30000 });
  await page.waitForTimeout(800);
  const source = () => page.evaluate(() => JSON.parse(localStorage.getItem("cd-player") ?? "{}").state?.source ?? "preview");
  report.sourceBefore = await source();
  await page.getByRole("button", { name: /connect/i }).first().click();
  await page.waitForTimeout(2500);
  report.sourceAfterGuideConnect = await source();
  await ctx.close();
}

// 2-3. Typing colors, and sharing a look with a code.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  watch(page, "look");
  await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: { active: false, ok: true } }));
  await page.goto(`${base}/#/settings`, { waitUntil: "load" });
  await page.waitForSelector("#colors", { timeout: 30000 });
  const hex = page.locator('input[aria-label="Ink (text) hex"]');
  await hex.click();
  await hex.press("Control+A");
  await hex.pressSequentially("#ff3366", { delay: 40 });
  await page.waitForTimeout(200);
  report.typedHex = await ink(page);
  await hex.press("Control+A");
  await hex.pressSequentially("0f0", { delay: 40 });
  await hex.press("Enter");
  await page.waitForTimeout(200);
  report.shortHex = await ink(page);
  await hex.press("Control+A");
  await hex.pressSequentially("#ff3366", { delay: 20 });
  await page.waitForTimeout(150);

  await page.locator("[data-share-look]").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Copy code" }).click();
  await page.waitForTimeout(300);
  const code = await page.evaluate(() => navigator.clipboard.readText());
  report.codeLength = code.length;
  report.codeStart = code.slice(0, 7);
  await hex.click();
  await hex.press("Control+A");
  await hex.pressSequentially("#123456", { delay: 10 });
  await hex.press("Enter");
  await page.waitForTimeout(150);
  report.changedInk = await ink(page);
  await page.locator('input[aria-label="Look code"]').fill(code);
  await page.waitForSelector("[data-share-preview]", { timeout: 5000 });
  await page.locator("[data-share-look]").screenshot({ path: `${out}/share-look-preview.png` });
  await page.getByRole("button", { name: "Use this look" }).click();
  await page.waitForTimeout(300);
  report.inkAfterCode = await ink(page);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  report.inkAfterUndo = await ink(page);
  await page.locator('input[aria-label="Look code"]').fill("KARASU-nonsense");
  await page.waitForTimeout(300);
  report.badCode = await page.locator("[data-share-look] .text-bad").innerText().catch(() => "");
  await ctx.close();
}

// 4. A widget's text color reaches the text inside it.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, "widget");
  await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: { active: false, ok: true } }));
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForSelector('[data-desk-item="clock"]', { timeout: 30000 });
  await page.getByRole("button", { name: "arrange", exact: true }).click();
  await page.locator('[data-desk-item="clock"]').click();
  const row = page.getByText("Text color", { exact: true }).locator("xpath=ancestor::*[.//input[@type='color']][1]");
  await row.locator('input[type="color"]').fill("#ff0000");
  await page.waitForTimeout(300);
  report.widgetText = await page.evaluate(() => {
    const item = document.querySelector('[data-desk-item="clock"]');
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    const colors = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (walker.currentNode.textContent.trim() && el) colors.add(getComputedStyle(el).color);
    }
    return [...colors];
  });
  await page.locator('[data-desk-item="clock"]').screenshot({ path: `${out}/widget-text-color.png` });
  await page.getByRole("button", { name: "reset", exact: true }).first().click().catch(() => undefined);
  await ctx.close();
}

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
