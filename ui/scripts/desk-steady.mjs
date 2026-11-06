import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

// Edit mode must show the desk at the same size and spot as normal mode, or things lined up with the wallpaper drift.
const base = process.env.KARASU_URL || "http://127.0.0.1:8768";
const json = (path, init) => fetch(base + path, init).then((r) => r.json());
for (let i = 0; i < 90; i++) {
  try {
    if ((await json("/api/health")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
await fetch(`${base}/api/setup/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {};
const problems = [];
for (const viewport of [{ width: 1440, height: 900 }, { width: 1320, height: 777 }]) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForSelector("[data-desk-item]", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const rects = () =>
    page.$$eval("[data-desk-item]", (els) =>
      Object.fromEntries(els.map((el) => {
        const r = el.getBoundingClientRect();
        return [el.getAttribute("data-desk-item"), [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10)];
      })),
    );
  const viewing = await rects();
  await page.getByRole("button", { name: "arrange", exact: true }).click();
  await page.waitForTimeout(900);
  const editing = await rects();
  const ids = Object.keys(viewing);
  const right = ids.map((id) => [id, editing[id]]).sort((a, b) => b[1][0] + b[1][2] - (a[1][0] + a[1][2]))[0][0];
  const dock = await page.locator("aside.glass").boundingBox();
  const at = await page.locator(`[data-desk-item="${right}"]`).boundingBox();
  await page.mouse.click(Math.min(at.x + at.width / 2, dock.x - 8), at.y + at.height / 2);
  await page.waitForTimeout(700);
  const panel = await page.locator("aside.glass").boundingBox();
  const picked = await page.locator(`[data-desk-item="${right}"]`).boundingBox();
  await page.screenshot({ path: `${SHOTS}/desk-steady-edit-${viewport.width}.png` });
  await page.getByRole("button", { name: /done/i }).click();
  await page.waitForTimeout(900);
  const after = await rects();
  const same = (a, b) => ids.every((id) => a[id] && b[id] && a[id].every((v, k) => Math.abs(v - b[id][k]) < 0.6));
  report[viewport.width] = {
    items: ids.length,
    sameInEditMode: same(viewing, editing),
    sameAfterDone: same(viewing, after),
    panelSide: panel && panel.x < viewport.width / 2 ? "left" : "right",
    panelCoversPicked: !!(panel && picked && picked.x < panel.x + panel.width && picked.x + picked.width > panel.x),
  };
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
