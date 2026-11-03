import { SHOTS } from "./paths.mjs";
import { chromium } from "playwright";
const base = process.env.CD_URL || "http://127.0.0.1:8766";
const out = SHOTS;
const ids = (process.env.CD_TRACKS || "dz:1497231712,dz:504902142").split(",");
const tracks = [];
for (const id of ids) tracks.push((await (await fetch(`${base}/api/tracks/${id}`)).json()).track);

const words = ["Every window in the quiet house is open wide tonight", "We kept the radio low so nobody would hear", "Paper boats along the gutter racing to the drain", "I forgot the words but the melody stayed", "Somebody left the porch light burning until morning", "Counting every streetlight on the long way home"];
const lyrics = (k) => ({ status: "ok", instrumental: false, plain: null, source: "LRCLIB", synced: Array.from({ length: 30 }, (_, i) => ({ t: i * 4, text: `${words[(i + k) % words.length]}${i % 3 === 0 ? ", and the rest of the line keeps going" : ""}` })) });
let current = 0;
const state = () => {
  const t = tracks[current];
  return {
    active: true, is_playing: true, progress_ms: 22000, shuffle: false, repeat: "off",
    device: { id: "dev", name: "YATO", type: "Computer", volume: 50 },
    track: { sp_id: t.sp_id || `fake${current}`, uri: `spotify:track:${t.sp_id}`, title: t.title, artist: t.artist.name, album: t.album.title, duration_ms: (t.duration_s || 200) * 1000, image: null },
  };
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
await page.route("**/api/player/spotify/**", (route) => {
  const url = route.request().url();
  if (url.includes("/state")) return route.fulfill({ json: state() });
  if (url.includes("/devices")) return route.fulfill({ json: { devices: [{ id: "dev", name: "YATO", type: "Computer", is_active: true, volume_percent: 50 }] } });
  return route.fulfill({ json: { ok: true, matched: 1 } });
});
await page.route("**/api/lyrics/**", (route) => route.fulfill({ json: lyrics(decodeURIComponent(route.request().url()).includes(tracks[0].id) ? 0 : 3) }));
await page.addInitScript((queue) => {
  localStorage.setItem("cd-prefs", JSON.stringify({ state: { systemAudio: false, launchSpotify: false, fullSongs: true }, version: 0 }));
  localStorage.setItem("cd-player", JSON.stringify({ state: { source: "spotify", deviceId: "dev", deviceName: "YATO", queue, index: 0, order: queue.map((_, i) => i), context: { label: "Test" } }, version: 0 }));
}, tracks);

const measure = () =>
  page.evaluate(() => {
    const np = document.querySelector("[class*='z-[60]']");
    const box = np.querySelector(".scroll-area");
    const active = [...box.querySelectorAll("[data-line]")].find((b) => b.classList.contains("scale-[1.02]"));
    const range = document.createRange();
    if (active) range.selectNodeContents(active);
    const text = active ? range.getBoundingClientRect() : null;
    const frame = np.querySelector(".aspect-square")?.firstElementChild;
    const img = frame?.querySelector("img:last-of-type");
    const scrolled = [...np.querySelectorAll("*")].filter((e) => e !== box && e.scrollTop > 0).length + (np.scrollTop > 0 ? 1 : 0);
    return {
      activeLine: active?.dataset.line ?? null,
      activeText: active?.textContent ?? null,
      textLeft: text && Math.round(text.left),
      boxLeft: Math.round(box.getBoundingClientRect().left),
      clipped: !!text && text.left < box.getBoundingClientRect().left,
      layoutScrolled: scrolled,
      closeTop: Math.round(np.querySelector("button[aria-label='Close Now Playing']").getBoundingClientRect().top),
      artOpacity: frame && getComputedStyle(frame).opacity,
      artVisibility: frame && getComputedStyle(frame).visibility,
      artLoaded: !!img && img.complete && img.naturalWidth > 0,
      artImgOpacity: img && getComputedStyle(img).opacity,
      artSrc: img?.getAttribute("src"),
    };
  });

await page.goto(`${base}/#/feed`, { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.locator("button[aria-label='Open Now Playing']:visible").first().click();
await page.waitForTimeout(1200);
await page.locator("[class*='z-[60]'] button[aria-label='Lyrics']").click();
await page.waitForTimeout(3000);
const first = await measure();
await page.screenshot({ path: `${out}/np-lyrics-a.png` });
await page.locator("[data-line='3']").click();
const focusAfterClick = await page.evaluate(() => document.activeElement?.getAttribute("data-line") ?? null);
await page.waitForTimeout(800);
current = 1;
await page.waitForTimeout(4000);
const second = await measure();
await page.screenshot({ path: `${out}/np-lyrics-b.png` });
console.log(JSON.stringify({ first, focusAfterClick, second }, null, 1));
console.log(problems.length ? problems.join("\n") : "no errors");
await browser.close();
