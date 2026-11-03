import { completeLook, FX, type Fx, type Look, type Wallpaper } from "./look";
import { SCENES } from "../components/visual/scenes";
import { VIZ_STYLES } from "../components/viz/styles";

const PREFIX = "KARASU-";
const VERSION = 1;
const MAX_CODE = 40_000;
const MAX_TEXT = 20_000;

// Only settings travel. Pictures live on your own PC, so the wallpaper, cursor images and button
// skins stay whatever the person pasting the code already has.
const LOCAL_FX: (keyof Fx)[] = ["cursorAsset", "cursorHover"];
const LOCAL_WALL: (keyof Wallpaper)[] = ["asset", "zoom", "x", "y", "position"];

const CHOICES: Record<string, readonly string[]> = {
  scheme: ["dark", "light"],
  shadow: ["none", "soft", "hard", "glow"],
  titlebar: ["bar", "line", "none"],
  fit: ["cover", "contain", "tile"],
  particles: ["none", "snow", "rain", "sakura", "fireflies", "dust", "stars"],
  scene: ["none", ...SCENES.map((s) => s.value)],
  sceneColor: ["ink", "accent", "art"],
  overlay: ["none", "scanlines", "vignette", "crt"],
  wallMotion: ["none", "drift", "parallax", "pulse"],
  cursor: ["default", "dot", "cross", "ring", "image"],
  cursorHot: ["tip", "center"],
  cursorInk: ["original", "ink", "light", "silhouette"],
  cursorTrail: ["none", "ink", "comet", "sparkle", "ripple"],
  covers: ["square", "rounded", "round"],
  dock: ["left", "right"],
  dockSize: ["compact", "normal", "large"],
  listDensity: ["comfortable", "compact"],
  npArt: ["cover", "vinyl", "cd"],
  playerStyle: ["floating", "docked"],
  vizStyle: VIZ_STYLES.map((v) => v.value),
};

type Plain = Record<string, unknown>;

const base = (): Look => ({ ...completeLook({}), fx: { ...FX }, preset: null });

function diff(value: Plain, against: Plain, skip: string[] = []): Plain {
  const out: Plain = {};
  for (const [key, v] of Object.entries(value)) {
    if (skip.includes(key) || v === undefined || JSON.stringify(v) === JSON.stringify(against[key])) continue;
    out[key] = v;
  }
  return out;
}

function clean(input: unknown, against: Plain, skip: string[] = []): Plain {
  const out: Plain = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, v] of Object.entries(input as Plain)) {
    if (skip.includes(key) || !(key in against)) continue;
    const want = against[key];
    if (typeof want === "number") {
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    } else if (typeof want === "boolean") {
      if (typeof v === "boolean") out[key] = v;
    } else if (typeof want === "string" || want === null) {
      if (typeof v !== "string" || v.length > MAX_TEXT) continue;
      if (CHOICES[key] && !CHOICES[key].includes(v)) continue;
      out[key] = v;
    }
  }
  return out;
}

function toBase64Url(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function squeeze(text: string, mode: "deflate" | "inflate") {
  const input = mode === "deflate" ? new TextEncoder().encode(text) : fromBase64Url(text);
  const stream = new Blob([input]).stream().pipeThrough(mode === "deflate" ? new CompressionStream("deflate-raw") : new DecompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return mode === "deflate" ? toBase64Url(bytes) : new TextDecoder().decode(bytes);
}

export async function lookToCode(look: Look): Promise<string> {
  const start = base();
  const payload: Plain = diff(look as unknown as Plain, start as unknown as Plain, ["wallpaper", "fx", "skins", "preset"]);
  const wall = diff(look.wallpaper as unknown as Plain, start.wallpaper as unknown as Plain, LOCAL_WALL);
  const fx = diff({ ...FX, ...(look.fx ?? {}) } as Plain, FX as unknown as Plain, LOCAL_FX);
  if (Object.keys(wall).length) payload.wallpaper = wall;
  if (Object.keys(fx).length) payload.fx = fx;
  return PREFIX + (await squeeze(JSON.stringify({ v: VERSION, l: payload }), "deflate"));
}

export type SharedLook = { look: Look; css: string; summary: string[] };

export async function codeToLook(code: string): Promise<SharedLook> {
  const raw = code.replace(/\s+/g, "");
  if (!raw.toUpperCase().startsWith(PREFIX)) throw new Error("Look codes start with KARASU-");
  if (raw.length > MAX_CODE) throw new Error("That code is too long to be a look");
  let parsed: { v?: number; l?: unknown };
  try {
    parsed = JSON.parse(await squeeze(raw.slice(PREFIX.length), "inflate"));
  } catch {
    throw new Error("That code is broken. Copy the whole thing and try again");
  }
  if (parsed.v !== VERSION || !parsed.l || typeof parsed.l !== "object") throw new Error("That code is from a different version of Karasu");
  const start = base();
  const shared = parsed.l as Plain;
  const top = clean(shared, start as unknown as Plain, ["wallpaper", "fx", "skins", "preset"]);
  const wall = clean(shared.wallpaper, start.wallpaper as unknown as Plain, LOCAL_WALL);
  const fx = clean(shared.fx, FX as unknown as Plain, [...LOCAL_FX, "css"]);
  const css = typeof (shared.fx as Plain | undefined)?.css === "string" ? String((shared.fx as Plain).css).slice(0, MAX_TEXT) : "";
  const look: Look = { ...start, ...top, wallpaper: { ...start.wallpaper, ...wall }, fx: { ...FX, ...fx } } as Look;
  return { look, css, summary: describe(look, css) };
}

function describe(look: Look, css: string) {
  const fx = { ...FX, ...(look.fx ?? {}) };
  const out = [`${look.scheme === "dark" ? "Dark" : "Light"} colors`];
  if (fx.particles !== "none") out.push(fx.particles[0].toUpperCase() + fx.particles.slice(1));
  if (fx.scene !== "none") out.push(`${SCENES.find((s) => s.value === fx.scene)?.label ?? fx.scene} visual`);
  if (fx.overlay !== "none") out.push(fx.overlay === "crt" ? "CRT screen" : fx.overlay[0].toUpperCase() + fx.overlay.slice(1));
  if (fx.cursorTrail !== "none") out.push(`${fx.cursorTrail} cursor trail`);
  if (fx.wallMotion !== "none") out.push(`${fx.wallMotion} wallpaper`);
  if (css.trim()) out.push("custom CSS");
  return out;
}

// Your own pictures and (unless you say so) your own custom CSS stay put.
export function mergeShared(current: Look, shared: SharedLook, useCss: boolean): Look {
  const now = { ...FX, ...(current.fx ?? {}) };
  const fx: Fx = { ...FX, ...(shared.look.fx ?? {}), cursorAsset: now.cursorAsset, cursorHover: now.cursorHover, css: useCss ? shared.css : now.css };
  if (fx.cursor === "image" && !fx.cursorAsset) fx.cursor = "default";
  const keep: Partial<Wallpaper> = {};
  for (const key of LOCAL_WALL) (keep as Plain)[key] = current.wallpaper[key];
  return {
    ...shared.look,
    wallpaper: { ...shared.look.wallpaper, ...keep },
    fx,
    skins: current.skins,
    preset: null,
  };
}
