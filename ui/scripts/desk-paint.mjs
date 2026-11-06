import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

// Visual widgets draw in the colors picked for them: a gradient on the bars, a custom color on the ring, gradient LEDs.
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
const bare = { titlebar: "none", bg: "none", border: 0, shadow: "none", padding: 0 };
const item = (id, kind, x, y, w, h, props) => ({ id, kind, x, y, w, h, r: 0, z: 50, hidden: false, locked: false, style: bare, props });
await put({
  ...saved,
  items: [
    item("viz", "visualizer", 40, 40, 400, 200, { style: "bars", bars: 24, gap: 0.3, sensitivity: 1, fall: 0.5, paint: "gradient", paintA: "#ff0000", paintB: "#0000ff", paintDir: "out", glow: 0 }),
    item("ring", "ring", 480, 40, 300, 300, { bars: 72, sensitivity: 1, art: false, spin: false, paint: "custom", paintA: "#00ff00", glow: 0.5 }),
    item("leds", "meters", 40, 300, 400, 120, { style: "led", count: "1", sensitivity: 1, paint: "gradient", paintA: "#ffff00", paintB: "#ff00ff", paintDir: "along" }),
  ],
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 777 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
const timers = [];
await page.routeWebSocket(/\/api\/audio\/levels/, (ws) => {
  const frame = new Uint8Array(65).fill(210);
  timers.push(setInterval(() => ws.send(Buffer.from(frame)), 30));
});
const report = {};
try {
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForSelector('[data-desk-item="viz"] canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);
  report.bars = await page.locator('[data-desk-item="viz"] canvas').evaluate((c) => {
    const ctx = c.getContext("2d");
    const at = (fy) => {
      const y = Math.round(c.height * fy);
      for (let x = 0; x < c.width; x++) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        if (a > 200) return [r, g, b];
      }
      return null;
    };
    return { bottom: at(0.97), top: at(0.35) };
  });
  report.barsBottomRed = !!report.bars.bottom && report.bars.bottom[0] > 180 && report.bars.bottom[2] < 90;
  report.barsTopBluer = !!report.bars.top && report.bars.top[2] > report.bars.top[0];
  report.ringGreen = await page.locator('[data-desk-item="ring"] canvas').evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let green = 0;
    let other = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] < 120) continue;
      if (d[i + 1] > 150 && d[i] < 90 && d[i + 2] < 90) green++;
      else other++;
    }
    return green > 50 && green > other * 3;
  });
  report.leds = await page.locator('[data-desk-item="leds"] canvas').evaluate((c) => {
    const ctx = c.getContext("2d");
    const y = Math.round(c.height / 2);
    const px = (fx) => Array.from(ctx.getImageData(Math.round(c.width * fx), y, 1, 1).data.slice(0, 3));
    return { left: px(0.1), right: px(0.85) };
  });
  report.ledsGoYellowToMagenta = report.leds.left[1] > report.leds.left[2] && report.leds.right[2] > report.leds.right[1];
  await page.screenshot({ path: `${SHOTS}/desk-paint.png`, clip: { x: 0, y: 0, width: 1320, height: 560 } });

  await page.getByRole("button", { name: "arrange", exact: true }).click();
  await page.waitForTimeout(800);
  const v = await page.locator('[data-desk-item="viz"]').boundingBox();
  await page.mouse.click(v.x + v.width / 2, v.y + v.height / 2);
  await page.waitForTimeout(500);
  const aside = page.locator("aside.glass");
  report.panelHasColorPickers = (await aside.locator('input[type="color"]').count()) >= 2;
  report.panelHasGradient = (await aside.getByText("Color 2").count()) === 1 && (await aside.getByText("Glow").count()) >= 1;
  await aside.screenshot({ path: `${SHOTS}/desk-paint-panel.png` });
} finally {
  timers.forEach(clearInterval);
  await put(saved);
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
process.exit(0);
