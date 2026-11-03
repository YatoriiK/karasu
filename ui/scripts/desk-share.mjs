import { readFileSync } from "node:fs";
import { ROOT, SHOTS } from "./paths.mjs";
import { chromium } from "playwright";

const mine = process.env.KARASU_URL || "http://127.0.0.1:8768";
const theirs = process.env.KARASU_FRIEND_URL || "http://127.0.0.1:8769";
const report = {};
const json = (url, init) => fetch(url, init).then((r) => r.json());
for (const base of [mine, theirs]) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await json(`${base}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  await fetch(`${base}/api/setup/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

const upload = (file, name) =>
  json(`${mine}/api/assets?name=${name}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: readFileSync(`${ROOT}/cache/tmp/${file}`) });
const wall = await upload("test-wall.png", "night.png");
const sticker = await upload("test-sticker.png", "red-moon.png");
const { active, layouts } = await json(`${mine}/api/layouts`);
const desk = layouts.find((l) => l.id === active);
const data = {
  ...desk.data,
  look: {
    ink: "#f2e8d5",
    accent: "#e05050",
    wallpaper: { asset: wall.id, fit: "cover", position: "center", dim: 0.1, blur: 0, mono: false },
    fx: { particles: "rain", density: 1.4 },
  },
  items: [
    ...desk.data.items.filter((i) => i.id !== "moon"),
    { id: "moon", kind: "image", x: 520, y: 150, w: 220, h: 220, r: 0, z: 30, hidden: false, locked: false, style: { bg: "none", border: 0, shadow: "none", titlebar: "none" }, props: { asset: sticker.id, fit: "contain", ink: "original" } },
  ],
};
await fetch(`${mine}/api/layouts/${desk.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Rainy test", data }) });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
const page = async (base, tag) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${tag} pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`${tag} console: ${m.text()}`));
  await p.route("**/api/player/spotify/**", (r) => r.fulfill({ json: r.request().url().includes("/devices") ? { devices: [] } : { active: false, ok: true } }));
  await p.goto(`${base}/#/settings`, { waitUntil: "load" });
  await p.waitForSelector("[data-share-desk]", { timeout: 30000 });
  await p.locator("[data-share-desk]").scrollIntoViewIfNeeded();
  return p;
};

const a = await page(mine, "mine");
const [download] = await Promise.all([a.waitForEvent("download"), a.locator("[data-share-desk]").getByRole("button", { name: /^Export/ }).click()]);
const file = `${ROOT}/cache/tmp/${download.suggestedFilename()}`;
await download.saveAs(file);
report.exportedFile = download.suggestedFilename();

const b = await page(theirs, "friend");
const before = await json(`${theirs}/api/assets`);
await b.locator('[data-share-desk] input[type="file"]').setInputFiles(file);
await b.waitForSelector("[data-desk-preview]", { timeout: 15000 });
report.preview = (await b.locator("[data-desk-preview]").innerText()).replace(/\s+/g, " ").slice(0, 120);
await b.locator("[data-share-desk]").screenshot({ path: `${SHOTS}/desk-share-preview.png` });
const loaded = new Set();
b.on("response", (r) => r.url().includes("/api/assets/") && r.status() === 200 && loaded.add(r.url().split("/api/assets/")[1].split("?")[0]));
await b.getByRole("button", { name: "Add desk" }).click();
await b.waitForTimeout(1500);
const after = await json(`${theirs}/api/layouts`);
const added = after.layouts.find((l) => l.id === after.active);
report.friendDesk = added?.name;
report.friendActiveIsNew = /^Rainy test( \d+)?$/.test(added?.name ?? "");
report.lookCame = { wall: added?.data.look?.wallpaper?.asset === wall.id, rain: added?.data.look?.fx?.particles === "rain" };
report.stickerCame = added?.data.items.some((i) => i.props?.asset === sticker.id);
const assets = await json(`${theirs}/api/assets`);
report.friendPictures = { before: before.length, after: assets.length, hasBoth: [wall.id, sticker.id].every((id) => assets.some((x) => x.id === id)) };

await b.goto(`${theirs}/#/`, { waitUntil: "load" });
await b.waitForTimeout(3000);
const onPage = await b.evaluate(() => {
  const urls = [...document.querySelectorAll("*")].flatMap((el) => [el.getAttribute("src") ?? "", getComputedStyle(el).backgroundImage]);
  return urls.filter((u) => u.includes("/api/assets/"));
});
report.picturesShownOnFriendDesk = [wall.id, sticker.id].every((id) => loaded.has(id) || onPage.some((u) => u.includes(id)));
await b.screenshot({ path: `${SHOTS}/desk-share-friend.png` });

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
