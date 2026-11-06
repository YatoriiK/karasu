import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

// Long lyric lines wrap instead of ending in "…", and the current line stays centered and fully visible.
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
await put({ ...saved, items: [{ id: "lyr", kind: "lyrics", x: 100, y: 60, w: 284, h: 394, r: 0, z: 10, hidden: false, locked: false, style: {}, props: { lines: 5, align: "center" } }] });

// Made-up test lines, not real lyrics.
const synced = [
  { t: 0, text: "Paper lanterns drifting slowly over the harbor while the tide keeps counting every hour" },
  { t: 5, text: "Short line" },
  { t: 9, text: "Another fairly long line about crows on the wire that should wrap onto two rows" },
  { t: 14, text: "Last one" },
];
const track = { id: "test-track", title: "Lantern Test", artist: { name: "Nobody", key: "nobody" }, album: { title: "Tests" }, art: null, has_preview: false, duration_s: 200, reasons: [], state: {} };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 777 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
await page.route("**/api/lyrics/**", (r) => r.fulfill({ json: { synced, plain: null, instrumental: false, status: "ok" } }));
await page.addInitScript((t) => {
  localStorage.setItem("cd-player", JSON.stringify({ state: { queue: [t], index: 0, volume: 0.8, muted: false, shuffle: false, repeat: "off" }, version: 0 }));
}, track);
const report = {};
try {
  await page.goto(`${base}/#/`, { waitUntil: "load" });
  await page.waitForSelector('[data-lyric-line="now"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  const box = await page.locator('[data-desk-item="lyr"]').boundingBox();
  const now = page.locator('[data-lyric-line="now"]');
  const line = await now.boundingBox();
  const info = await now.evaluate((el) => ({
    text: el.textContent,
    cut: el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis",
    rows: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
  }));
  const reel = await page.locator('[data-desk-item="lyr"] [data-lyric-line]').first().evaluate((el) => {
    const frame = el.parentElement.parentElement.getBoundingClientRect();
    return { top: frame.top, bottom: frame.bottom };
  });
  report.wholeLineShown = !info.cut && info.text.endsWith("hour");
  report.wrapsOntoRows = info.rows;
  report.insideWidget = line.y >= reel.top - 1 && line.y + line.height <= reel.bottom + 1;
  report.centered = Math.abs(line.y + line.height / 2 - (reel.top + reel.bottom) / 2) < 4;
  report.widget = `${Math.round(box.width)}x${Math.round(box.height)}`;
  await page.locator('[data-desk-item="lyr"]').screenshot({ path: `${SHOTS}/desk-lyrics.png` });
} finally {
  await put(saved);
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
process.exit(0);
