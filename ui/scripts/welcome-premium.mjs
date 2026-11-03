import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.KARASU_URL || "http://127.0.0.1:8768";
const out = SHOTS;
const report = {};
const s = { clientId: "", loggedIn: false, running: false, finished: false, requested: false, job: null, calls: [] };
const CLIENT = "0123456789abcdef0123456789abcdef";

const setup = () => ({
  done: s.finished,
  needed: !s.finished && !s.loggedIn,
  path: s.clientId ? "premium" : null,
  history_requested: s.requested,
  redirect_uri: "http://127.0.0.1:8888/callback",
  client_id: s.clientId,
  spotify: { configured: !!s.clientId, logged_in: s.loggedIn, user: s.loggedIn ? { id: "u1", name: "Test Listener", product: "premium" } : {} },
  library: s.loggedIn,
  synced: !!s.job,
  picks: [],
  job: s.job,
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const run = async (viewport, tag) => {
  const page = await browser.newPage({ viewport });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`console: ${m.text()}`));
  await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
  await page.route("**/api/setup**", async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    s.calls.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/api/setup") return r.fulfill({ json: setup() });
    if (url.pathname === "/api/setup/spotify") {
      const id = (req.postDataJSON().client_id || "").trim().toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(id)) return r.fulfill({ status: 400, json: { detail: "That doesn't look like a Client ID." } });
      s.clientId = id;
      return r.fulfill({ json: setup() });
    }
    if (url.pathname === "/api/setup/sync") {
      s.job = { id: "jobP", status: "running", stage: "Listening to your library", done: 340, total: 2400, error: null };
      return r.fulfill({ json: { job: "jobP" } });
    }
    if (url.pathname === "/api/setup/finish") {
      const body = req.postDataJSON();
      s.finished = true;
      s.requested = !!body.history_requested;
      report.finishBody = body;
      return r.fulfill({ json: setup() });
    }
    return r.fulfill({ status: 404, json: {} });
  });
  await page.route("**/api/spotify/status", (r) =>
    r.fulfill({
      json: {
        configured: !!s.clientId,
        logged_in: s.loggedIn,
        missing_scopes: [],
        login_running: s.running,
        login_error: null,
        login_url: s.running ? "https://accounts.spotify.com/authorize?client_id=x" : null,
        user: s.loggedIn ? { id: "u1", name: "Test Listener", product: "premium" } : {},
      },
    }),
  );
  await page.route("**/api/spotify/login", (r) => {
    s.running = true;
    setTimeout(() => {
      s.running = false;
      s.loggedIn = true;
    }, 3500);
    return r.fulfill({ json: { started: true } });
  });
  await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 })));
  return { page, problems };
};

const { page, problems } = await run({ width: 1440, height: 900 });
await page.goto(`${base}/#/`, { waitUntil: "load" });
await page.waitForURL(/#\/welcome/, { timeout: 30000 });
await page.click("[data-choice=premium]");
await page.waitForSelector("[data-welcome=key]");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/premium-key.png`, fullPage: false });
await page.fill("input[aria-label='Client ID']", "not-an-id");
await page.click("button:has-text('Save and continue')");
report.badIdMessage = await page.locator("form p.text-bad").innerText();
await page.fill("input[aria-label='Client ID']", ` ${CLIENT.toUpperCase()} `);
await page.click("button:has-text('Save and continue')");
await page.waitForSelector("[data-welcome=connect]");
report.savedClient = s.clientId === CLIENT;
await page.click("button:has-text('Connect Spotify')");
await page.waitForSelector("text=Waiting for Spotify", { timeout: 5000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/premium-waiting.png` });
report.reopenLink = await page.locator("text=Browser didn't open?").count();
await page.waitForSelector("[data-connected]", { timeout: 15000 });
await page.waitForSelector("[data-setup-job]", { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/premium-connected.png` });
report.connectedText = (await page.locator("[data-connected]").innerText()).replace(/\s+/g, " ").slice(0, 160);
await page.click("button:has-text('Continue')");
await page.waitForSelector("[data-welcome=history]");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/premium-history.png` });
report.backgroundNote = await page.locator("text=Still getting your music ready").count();
await page.click("[data-requested]");
await page.click("button:has-text('Finish')");
await page.waitForFunction(() => location.hash === "#/" || location.hash === "", null, { timeout: 15000 });
report.endedOnDesk = true;

const mobile = await run({ width: 390, height: 844 });
s.finished = false;
await mobile.page.goto(`${base}/#/welcome?step=key&path=premium`, { waitUntil: "load" });
await mobile.page.waitForSelector("[data-welcome=key]", { timeout: 30000 });
await mobile.page.waitForTimeout(600);
await mobile.page.screenshot({ path: `${out}/premium-key-mobile.png` });
report.mobileOverflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
await mobile.page.goto(`${base}/#/welcome?step=history&path=premium`, { waitUntil: "load" });
await mobile.page.waitForSelector("[data-welcome=history]", { timeout: 30000 });
await mobile.page.waitForTimeout(600);
await mobile.page.screenshot({ path: `${out}/premium-history-mobile.png` });

report.calls = s.calls.filter((c) => !c.endsWith("/api/setup"));
console.log(JSON.stringify(report, null, 1));
const all = [...problems, ...mobile.problems];
console.log(all.length ? all.join("\n") : "no errors");
await browser.close();
