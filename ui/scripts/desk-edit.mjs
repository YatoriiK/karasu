import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const base = process.env.CD_URL || "http://127.0.0.1:8765";
const out = SHOTS;
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const before = await api("GET", "/api/layouts");
const active = before.layouts.find((l) => l.id === before.active);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
const results = {};
try {
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "arrange", exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/edit-add.png` });

  const item = (id) => page.locator(`[data-desk-item="${id}"]`);
  const box = async (id) => item(id).boundingBox();

  const viz = await box("visualizer");
  await page.mouse.move(viz.x + viz.width / 2, viz.y + viz.height / 2);
  await page.mouse.down();
  await page.mouse.move(viz.x + viz.width / 2 - 120, viz.y + viz.height / 2 - 60, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const moved = await box("visualizer");
  results.moved = { dx: Math.round(moved.x - viz.x), dy: Math.round(moved.y - viz.y) };

  const handle = page.locator(`[data-desk-item="visualizer"] [data-handle="se"]`);
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const resized = await box("visualizer");
  results.resized = { dw: Math.round(resized.width - moved.width), dh: Math.round(resized.height - moved.height) };
  await page.screenshot({ path: `${out}/edit-element.png` });

  const crow = await box("crow");
  await page.mouse.click(crow.x + crow.width / 2, crow.y + crow.height / 2);
  await page.waitForTimeout(300);
  const rot = page.locator(`[data-desk-item="crow"] [data-handle="rotate"]`);
  const rb = await rot.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 140, rb.y + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1300);
  const after = await api("GET", "/api/layouts");
  const crowItem = after.layouts.find((l) => l.id === before.active).data.items.find((i) => i.id === "crow");
  results.rotated = crowItem?.r;

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1300);
  const undone = await api("GET", "/api/layouts");
  results.undoRotation = undone.layouts.find((l) => l.id === before.active).data.items.find((i) => i.id === "crow")?.r;

  await page.getByRole("button", { name: "layers" }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/edit-layers.png` });
  await page.getByRole("button", { name: "desk", exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/edit-desk.png` });
  await page.getByRole("button", { name: "done" }).click();
  await page.waitForTimeout(500);
} catch (error) {
  problems.push(`script: ${String(error.message).slice(0, 200)}`);
  await page.screenshot({ path: `${out}/edit-error.png` }).catch(() => undefined);
} finally {
  await api("PUT", `/api/layouts/${active.id}`, { name: active.name, data: active.data });
  await browser.close();
}
console.log(JSON.stringify(results));
console.log(problems.length ? problems.join("\n") : "no console errors");
