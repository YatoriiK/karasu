import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

// Free mode puts a widget exactly where it's dropped, and "frameless" leaves no ring, border or shadow.
const base = process.env.KARASU_URL || "http://127.0.0.1:8768";
const json = (path, init) => fetch(base + path, init).then((r) => r.json());
for (let i = 0; i < 90; i++) {
  try {
    if ((await json("/api/health")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
await fetch(`${base}/api/setup/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const { active, layouts } = await json("/api/layouts");
const desk = layouts.find((l) => l.id === active);
const saved = structuredClone(desk.data);
const put = (data) => fetch(`${base}/api/layouts/${desk.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: desk.name, data }) });
const viz = { id: "freeviz", kind: "visualizer", x: 300, y: 200, w: 256, h: 128, r: 0, z: 90, hidden: false, locked: false, style: {}, props: {} };
await put({ ...saved, snap: true, items: [viz] });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 777 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
const report = {};
try {
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForSelector('[data-desk-item="freeviz"]', { timeout: 30000 });
  await page.getByRole("button", { name: "arrange", exact: true }).click();
  await page.waitForTimeout(900);
  const pos = async () => (await json("/api/layouts")).layouts.find((l) => l.id === desk.id).data.items.find((i) => i.id === "freeviz");
  const drag = async (dx, dy) => {
    const b = await page.locator('[data-desk-item="freeviz"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
  };
  const scale = (await page.locator('[data-desk-item="freeviz"]').boundingBox()).width / 256;
  await drag(13 * scale, 7 * scale);
  const snapped = await pos();
  report.snapMode = { x: snapped.x, y: snapped.y, onGrid: snapped.x % 8 === 0 || snapped.y % 8 === 0 };
  await page.getByRole("button", { name: /^snap$/ }).click();
  await page.waitForTimeout(300);
  await drag(13 * scale, 7 * scale);
  const free = await pos();
  report.freeMode = { from: [snapped.x, snapped.y], to: [free.x, free.y], exact: free.x - snapped.x === 13 && free.y - snapped.y === 7 };

  await page.locator('[data-desk-item="freeviz"]').click();
  await page.getByRole("button", { name: "frameless" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /done/i }).click();
  await page.waitForTimeout(900);
  report.frame = await page.locator('[data-desk-item="freeviz"] > div > div').first().evaluate((el) => {
    const c = getComputedStyle(el);
    return { shadow: c.boxShadow, border: c.borderTopWidth, radius: c.borderTopLeftRadius, background: c.backgroundColor };
  });
  report.titleShown = await page.locator('[data-desk-item="freeviz"]').getByText("cava").count();
  await page.locator('[data-desk-item="freeviz"]').screenshot({ path: `${SHOTS}/desk-frameless.png` });
} finally {
  await put(saved);
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
