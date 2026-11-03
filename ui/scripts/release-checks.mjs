import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const base = process.env.CD_URL || "http://127.0.0.1:8768";
const out = SHOTS;
const report = {};
for (let i = 0; i < 90; i++) {
  try {
    if ((await (await fetch(`${base}/api/health`)).json()).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
await fetch(`${base}/api/setup/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const watch = (page, tag) => {
  page.on("pageerror", (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`${tag} console: ${m.text()}`));
};

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page, "settings");
await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.addInitScript(() => localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: false }, version: 0 })));
await page.goto(`${base}/#/settings`, { waitUntil: "load" });
await page.waitForSelector("#connections", { timeout: 30000 });
await page.locator("#connections").scrollIntoViewIfNeeded();
const lastfm = page.locator("[data-key-row=lastfm]");
report.noConfigPath = (await page.locator("#connections").innerText()).includes("config.toml") ? "STILL MENTIONS config.toml" : "ok";
await lastfm.getByRole("button", { name: "Paste API key" }).click();
await lastfm.locator("input").fill("abc");
await lastfm.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(400);
report.badFormat = (await lastfm.locator(".text-bad").innerText().catch(() => "")).slice(0, 80);
await lastfm.locator("input").fill("0123456789abcdef0123456789abcdef");
await lastfm.getByRole("button", { name: "Save" }).click();
await lastfm.locator(".text-bad").filter({ hasNotText: "doesn't look like" }).waitFor({ timeout: 20000 }).catch(() => undefined);
report.rejected = (await lastfm.locator(".text-bad").innerText().catch(() => "")).slice(0, 80);
report.keyStillOff = !(await (await fetch(`${base}/api/health`)).json()).keys.lastfm;
await page.locator("#connections").screenshot({ path: `${out}/release-connections.png` });

const toggle = page.locator("#connections button[role=switch]");
report.mapOffAtStart = (await toggle.getAttribute("aria-checked")) === "false";
await toggle.click();
await page.waitForTimeout(300);
report.mapOnAfterToggle = (await (await fetch(`${base}/api/listeners/enabled`)).json()).enabled;
await toggle.click();
await page.waitForTimeout(300);
report.mapOffAgain = !(await (await fetch(`${base}/api/listeners/enabled`)).json()).enabled;
report.offLookup = (await (await fetch(`${base}/api/listeners?artist=Duster`)).json()).status;

const tauri = await browser.newPage({ viewport: { width: 1280, height: 820 } });
watch(tauri, "setup");
await tauri.addInitScript(() => {
  const calls = [];
  const callbacks = {};
  let next = 1;
  let info = {
    home: null,
    default_home: "C:\\Users\\crow\\Karasu",
    dev: false,
    ready: false,
    installing: false,
    error: null,
    gpu: false,
    free_bytes: 48 * 1024 ** 3,
    needs_bytes: 3 * 1024 ** 3,
    log: null,
  };
  const listeners = [];
  window.__karasu = { calls, emit: (payload) => listeners.forEach((id) => callbacks[id]?.({ event: "engine-install", id: 1, payload })) };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb) {
      const id = next++;
      callbacks[id] = cb;
      return id;
    },
    unregisterCallback(id) {
      delete callbacks[id];
    },
    async invoke(cmd, args) {
      calls.push(cmd);
      if (cmd === "engine_info") return info;
      if (cmd === "set_engine_home") {
        info = { ...info, home: args.path, log: `${args.path}\\data\\logs` };
        return info;
      }
      if (cmd === "install_engine") return null;
      if (cmd === "plugin:event|listen") {
        listeners.push(args.handler);
        return 1;
      }
      if (cmd === "plugin:dialog|open") return "D:\\";
      return null;
    },
  };
});
await tauri.goto(`${base}/`, { waitUntil: "load" });
await tauri.getByText("Set up Karasu's engine").waitFor({ timeout: 15000 });
report.defaultHome = await tauri.locator("[data-engine-home]").innerText();
await tauri.waitForTimeout(900);
await tauri.screenshot({ path: `${out}/release-engine-choose.png` });
await tauri.getByRole("button", { name: "Change…" }).click();
await tauri.waitForTimeout(200);
report.pickedDrive = await tauri.locator("[data-engine-home]").innerText();
await tauri.getByRole("button", { name: "Install engine" }).click();
await tauri.getByText("Setting up Karasu's engine").waitFor({ timeout: 5000 });
await tauri.evaluate(() => window.__karasu.emit({ stage: "step", step: 3, steps: 5, label: "Installing PyTorch", detail: "" }));
await tauri.evaluate(() =>
  window.__karasu.emit({ stage: "line", step: 3, steps: 5, label: "Installing PyTorch", detail: "Downloading torch (204.1MiB)" }),
);
await tauri.waitForTimeout(300);
report.activeStep = await tauri.locator("[data-install-step]").getAttribute("data-install-step");
await tauri.screenshot({ path: `${out}/release-engine-installing.png` });
await tauri.evaluate(() =>
  window.__karasu.emit({ stage: "error", step: 0, steps: 0, label: "", detail: "Installing PyTorch failed (exit code: 1).\nerror: Failed to fetch: `https://download.pytorch.org/whl/cpu/torch/`" }),
);
await tauri.getByText("Setup stopped").waitFor({ timeout: 5000 });
await tauri.screenshot({ path: `${out}/release-engine-error.png` });
await tauri.getByRole("button", { name: "Try again" }).click();
await tauri.waitForTimeout(200);
report.retried = await tauri.evaluate(() => window.__karasu.calls.filter((c) => c === "install_engine").length);
report.setupScreenAfterRetry = await tauri.getByText("Setting up Karasu's engine").count();
await tauri.setViewportSize({ width: 390, height: 844 });
await tauri.waitForTimeout(200);
report.mobileOverflow = await tauri.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
await tauri.screenshot({ path: `${out}/release-engine-mobile.png` });

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
