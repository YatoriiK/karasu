import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const report = {};
for (let i = 0; i < 90; i++) {
  try {
    if ((await (await fetch(`${base}/api/health`)).json()).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 })));
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("karasu-global-keys") ?? "{}").state ?? {});
const chip = (id) => page.locator(`[data-recorder=${id}]`).innerText().then((t) => t.replace(/\s+/g, " ").trim());

await page.goto(`${base}/#/settings`, { waitUntil: "load" });
await page.waitForSelector("#anywhere", { timeout: 30000 });
await page.locator("nav[aria-label='Settings sections']:visible a[href='#anywhere']").click();
await page.waitForTimeout(800);
report.offInitially = (await saved()).enabled ?? false;
await page.locator("#anywhere button[role=switch]").click();
await page.waitForTimeout(300);
report.enabled = (await saved()).enabled;
report.defaults = { next: await chip("next"), playPause: await chip("playPause") };

await page.click("[data-recorder=next]");
await page.keyboard.press("k");
await page.waitForTimeout(150);
report.plainKeyHint = await page.locator("#anywhere").getByText("Hold Ctrl, Alt or Shift").count();
await page.keyboard.press("Control+Shift+KeyN");
await page.waitForTimeout(200);
report.recorded = await chip("next");
report.savedNext = (await saved()).bindings?.next;

await page.click("[data-recorder=prev]");
await page.keyboard.press("Control+Shift+KeyN");
await page.waitForTimeout(200);
report.duplicate = { prev: await chip("prev"), next: await chip("next") };

await page.click("[data-recorder=mute]");
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
report.cleared = await chip("mute");

await page.click("[data-recorder=like]");
await page.keyboard.press("F9");
await page.waitForTimeout(150);
report.fKeyAlone = await chip("like");

await page.click("[data-recorder=volumeUp]");
await page.waitForTimeout(150);
await page.locator("#anywhere").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/global-keys-recording.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
report.escKeeps = await chip("volumeUp");
await page.screenshot({ path: `${out}/global-keys.png` });

await page.locator("nav[aria-label='Main'] a[aria-label='Desk']").click();
await page.waitForTimeout(800);
await page.keyboard.press("Shift+Slash");
await page.waitForTimeout(600);
report.dialogSection = await page.getByText("Anywhere, even in games").count();
await page.screenshot({ path: `${out}/global-keys-dialog.png` });

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
