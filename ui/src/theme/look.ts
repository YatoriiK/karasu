import { create } from "zustand";
import { persist } from "zustand/middleware";
import { media } from "../lib/api";
import type { SceneKind } from "../components/visual/scenes";

export type Shadow = "none" | "soft" | "hard" | "glow";
export type Titlebar = "bar" | "line" | "none";

export type Wallpaper = {
  asset: string | null;
  fit: "cover" | "contain" | "tile";
  position: string;
  dim: number;
  blur: number;
  mono: boolean;
  zoom?: number;
  x?: number;
  y?: number;
};

export type Look = {
  scheme: "dark" | "light";
  paper: string;
  surface: string;
  ink: string;
  accent: string;
  accentInk: string;
  surfaceAlpha: number;
  blur: number;
  radius: number;
  border: number;
  shadow: Shadow;
  titlebar: Titlebar;
  glow: number;
  grain: number;
  font: string;
  display: string;
  mono: string;
  scale: number;
  artAccent: boolean;
  dockLabels: boolean;
  wallpaper: Wallpaper;
  fx?: Partial<Fx>;
  skins?: Record<string, SkinEntry>;
  preset?: string | null;
};

export type SkinMode = "ink" | "light" | "silhouette" | "original";
export type SkinEntry = { asset: string; mode: SkinMode };

export type Particles = "none" | "snow" | "rain" | "sakura" | "fireflies" | "dust" | "stars";
export type CursorTrail = "none" | "ink" | "comet" | "sparkle" | "ripple";

export type Fx = {
  particles: Particles;
  density: number;
  speed: number;
  react: boolean;
  scene: "none" | SceneKind;
  sceneStrength: number;
  sceneSense: number;
  sceneColor: "ink" | "accent" | "art";
  overlay: "none" | "scanlines" | "vignette" | "crt";
  wallMotion: "none" | "drift" | "parallax" | "pulse";
  slideshow: number;
  cursor: "default" | "dot" | "cross" | "ring" | "image";
  cursorAsset: string | null;
  cursorHover: string | null;
  cursorSize: number;
  cursorHot: "tip" | "center";
  cursorInk: "original" | "ink" | "light" | "silhouette";
  cursorSmooth: boolean;
  cursorReact: boolean;
  cursorTrail: CursorTrail;
  covers: "square" | "rounded" | "round";
  weight: number;
  dock: "left" | "right";
  dockSize: "compact" | "normal" | "large";
  clock24: boolean;
  clockDate: boolean;
  listDensity: "comfortable" | "compact";
  npArt: "cover" | "vinyl" | "cd";
  playerStyle: "floating" | "docked";
  npViz: boolean;
  vizStyle: string;
  css: string;
};

export const FX: Fx = {
  particles: "none",
  density: 1,
  speed: 1,
  react: true,
  scene: "none",
  sceneStrength: 0.7,
  sceneSense: 1,
  sceneColor: "ink",
  overlay: "none",
  wallMotion: "none",
  slideshow: 0,
  cursor: "default",
  cursorAsset: null,
  cursorHover: null,
  cursorSize: 32,
  cursorHot: "tip",
  cursorInk: "original",
  cursorSmooth: false,
  cursorReact: false,
  cursorTrail: "none",
  covers: "rounded",
  weight: 400,
  dock: "left",
  dockSize: "normal",
  clock24: false,
  clockDate: true,
  listDensity: "comfortable",
  npArt: "cover",
  playerStyle: "floating",
  npViz: true,
  vizStyle: "smoke",
  css: "",
};

export const fxOf = (look: Look): Fx => ({ ...FX, ...(look.fx ?? {}) });

export function useFx<K extends keyof Fx>(key: K): Fx[K] {
  return useLook((s) => (s.look.fx?.[key] ?? FX[key]) as Fx[K]);
}

export const FONTS: { id: string; label: string; family: string; note: string }[] = [
  { id: "jetbrains", label: "Terminal", family: "'JetBrains Mono Variable'", note: "JetBrains Mono" },
  { id: "inter", label: "Clean", family: "'Inter Variable'", note: "Inter" },
  { id: "mincho", label: "Mincho", family: "'Shippori Mincho'", note: "Shippori Mincho" },
  { id: "brush", label: "Brush", family: "'Yuji Syuku'", note: "Yuji Syuku" },
  { id: "gothic", label: "Gothic", family: "'Zen Kaku Gothic New'", note: "Zen Kaku Gothic" },
  { id: "pixel", label: "Pixel", family: "'DotGothic16'", note: "DotGothic16" },
];

const JP_FALLBACK = "'Zen Kaku Gothic New', 'Yu Gothic UI', 'Meiryo', ui-sans-serif, system-ui, sans-serif";

export function fontStack(id: string) {
  const known = FONTS.find((f) => f.id === id);
  if (known) return `${known.family}, ${JP_FALLBACK}`;
  const custom = id.replace(/["';{}<>]/g, "").trim();
  return custom ? `"${custom}", ${JP_FALLBACK}` : JP_FALLBACK;
}

const wallpaper: Wallpaper = { asset: null, fit: "cover", position: "center", dim: 0.25, blur: 0, mono: true };

export const PRESETS: Record<string, { name: string; kanji: string; look: Look }> = {
  sumi: {
    name: "Sumi night",
    kanji: "墨",
    look: {
      scheme: "dark",
      paper: "#050505",
      surface: "#0b0b0c",
      ink: "#ecebe6",
      accent: "#ecebe6",
      accentInk: "#0a0a0a",
      surfaceAlpha: 0.6,
      blur: 18,
      radius: 14,
      border: 1,
      shadow: "glow",
      titlebar: "line",
      glow: 0.55,
      grain: 0.08,
      font: "jetbrains",
      display: "mincho",
      mono: "jetbrains",
      scale: 1,
      artAccent: false,
      dockLabels: true,
      wallpaper,
    },
  },
  washi: {
    name: "Washi paper",
    kanji: "紙",
    look: {
      scheme: "light",
      paper: "#c9c5b9",
      surface: "#c9c5b9",
      ink: "#191817",
      accent: "#262626",
      accentInk: "#efece4",
      surfaceAlpha: 1,
      blur: 0,
      radius: 0,
      border: 0,
      shadow: "hard",
      titlebar: "bar",
      glow: 0,
      grain: 0.12,
      font: "jetbrains",
      display: "mincho",
      mono: "jetbrains",
      scale: 1,
      artAccent: false,
      dockLabels: true,
      wallpaper: { ...wallpaper, dim: 0, mono: true },
    },
  },
  kumo: {
    name: "Kumo",
    kanji: "雲",
    look: {
      scheme: "dark",
      paper: "#070a10",
      surface: "#0e121a",
      ink: "#e7eaf0",
      accent: "#e7eaf0",
      accentInk: "#0b0e14",
      surfaceAlpha: 0.42,
      blur: 26,
      radius: 22,
      border: 1,
      shadow: "soft",
      titlebar: "none",
      glow: 0.3,
      grain: 0.05,
      font: "inter",
      display: "mincho",
      mono: "jetbrains",
      scale: 1,
      artAccent: false,
      dockLabels: false,
      wallpaper: { ...wallpaper, dim: 0.15 },
    },
  },
  hanko: {
    name: "Hanko",
    kanji: "判",
    look: {
      scheme: "light",
      paper: "#f3f0e8",
      surface: "#fbf9f4",
      ink: "#141414",
      accent: "#a8241c",
      accentInk: "#fbf9f4",
      surfaceAlpha: 0.92,
      blur: 6,
      radius: 3,
      border: 1.5,
      shadow: "hard",
      titlebar: "line",
      glow: 0,
      grain: 0.14,
      font: "gothic",
      display: "brush",
      mono: "jetbrains",
      scale: 1,
      artAccent: false,
      dockLabels: true,
      wallpaper: { ...wallpaper, dim: 0, mono: true },
    },
  },
};

export type SavedLook = { id: string; name: string; look: Look };

type LookState = {
  look: Look;
  shared: Look;
  desk: number | null;
  saved: SavedLook[];
  set: (patch: Partial<Look>) => void;
  setWallpaper: (patch: Partial<Wallpaper>) => void;
  setFx: (patch: Partial<Fx>) => void;
  setSkins: (skins: Record<string, SkinEntry>) => void;
  usePreset: (id: string) => void;
  useSaved: (id: string) => void;
  save: (name: string) => void;
  remove: (id: string) => void;
  replace: (look: Look) => void;
  show: (desk: number | null, look: Look | null) => void;
  share: () => void;
};

export function completeLook(look: Partial<Look> | null | undefined): Look {
  return { ...PRESETS.sumi.look, ...(look ?? {}), wallpaper: { ...wallpaper, ...(look?.wallpaper ?? {}) } };
}

let deskWriter: ((desk: number, look: Look) => void) | null = null;

export function bindDeskLooks(writer: typeof deskWriter) {
  deskWriter = writer;
}

const PREF_KEYS: [string, keyof Fx][] = [
  ["clock24", "clock24"],
  ["clockDate", "clockDate"],
  ["density", "listDensity"],
  ["npArt", "npArt"],
  ["playerStyle", "playerStyle"],
  ["visualizer", "npViz"],
  ["vizStyle", "vizStyle"],
];

function stored(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null")?.state ?? null;
  } catch {
    return null;
  }
}

export const useLook = create<LookState>()(
  persist(
    (set, get) => {
      const commit = (next: Look) => {
        const desk = get().desk;
        if (desk != null && deskWriter) {
          set({ look: next });
          deskWriter(desk, next);
        } else set({ look: next, shared: next });
      };
      const start = { ...PRESETS.sumi.look, preset: "sumi" };
      return {
        look: start,
        shared: start,
        desk: null,
        saved: [],
        set: (patch) => commit({ ...get().look, ...patch, preset: null }),
        setWallpaper: (patch) => commit({ ...get().look, wallpaper: { ...get().look.wallpaper, ...patch } }),
        setFx: (patch) => commit({ ...get().look, fx: { ...fxOf(get().look), ...patch } }),
        setSkins: (skins) => commit({ ...get().look, skins }),
        usePreset: (id) => {
          const p = PRESETS[id];
          const now = get().look;
          if (p) commit({ ...p.look, fx: now.fx, skins: now.skins, wallpaper: { ...p.look.wallpaper, asset: now.wallpaper.asset }, preset: id });
        },
        useSaved: (id) => {
          const s = get().saved.find((x) => x.id === id);
          if (s) commit({ ...completeLook(s.look), preset: null });
        },
        save: (name) =>
          set({ saved: [...get().saved, { id: Math.random().toString(36).slice(2, 9), name: name.trim() || "My look", look: get().look }] }),
        remove: (id) => set({ saved: get().saved.filter((s) => s.id !== id) }),
        replace: (look) => commit({ ...completeLook(look), fx: { ...FX, ...(look.fx ?? {}) }, preset: null }),
        show: (desk, look) => {
          const now = get();
          if (look && look === now.look && desk === now.desk) return;
          const next = look ? completeLook(look) : now.shared;
          if (next === now.look && desk === now.desk) return;
          set({ desk, look: next });
        },
        share: () => set({ shared: get().look }),
      };
    },
    {
      name: "karasu-look",
      version: 2,
      partialize: (s) => ({ look: s.look, shared: s.shared, desk: s.desk, saved: s.saved }),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as { look?: Look; shared?: Look; preset?: string | null; saved?: SavedLook[]; desk?: number | null };
        if (version >= 2) return p as never;
        const prefs = stored("cd-prefs") ?? {};
        const fx: Partial<Fx> = { ...(p.look?.fx ?? {}) };
        for (const [from, to] of PREF_KEYS) if (prefs[from] !== undefined) (fx as Record<string, unknown>)[to] = prefs[from];
        const skins = stored("karasu-skins")?.skins as Record<string, SkinEntry> | undefined;
        const look: Look = { ...completeLook(p.look), fx, preset: p.preset ?? null, ...(skins && Object.keys(skins).length ? { skins } : {}) };
        return { look, shared: look, desk: null, saved: p.saved ?? [] };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LookState>;
        const look = completeLook(p.look ?? current.look);
        return { ...current, ...p, look, shared: p.shared ? completeLook(p.shared) : look };
      },
    },
  ),
);

const shadows: Record<Shadow, string> = {
  none: "none",
  soft: "0 24px 60px -24px rgb(0 0 0 / 0.7), 0 4px 14px -6px rgb(0 0 0 / 0.45)",
  hard: "var(--hard-x, 6px) var(--hard-y, 6px) 0 0 color-mix(in srgb, var(--hard-ink) 30%, transparent)",
  glow: "0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent), 0 0 32px -6px color-mix(in srgb, var(--ink) calc(var(--glow) * 30%), transparent)",
};

export function applyLook(look: Look) {
  const root = document.documentElement;
  const s = root.style;
  root.dataset.scheme = look.scheme;
  root.dataset.titlebar = look.titlebar;
  s.colorScheme = look.scheme;
  s.setProperty("--paper", look.paper);
  s.setProperty("--surface", look.surface);
  s.setProperty("--ink", look.ink);
  s.setProperty("--accent-base", look.accent);
  s.setProperty("--accent-ink", look.accentInk);
  s.setProperty("--surface-alpha", `${Math.round(look.surfaceAlpha * 100)}%`);
  s.setProperty("--surface-blur", `${look.blur}px`);
  s.setProperty("--round", String(look.radius / 14));
  s.setProperty("--border-w", `${look.border}px`);
  s.setProperty("--glow", String(look.glow));
  s.setProperty("--grain", String(look.grain));
  s.setProperty("--hard-ink", look.scheme === "dark" ? "#000" : "#000");
  s.setProperty("--shadow-win", shadows[look.shadow]);
  s.setProperty("--font-ui", fontStack(look.font));
  s.setProperty("--font-display-stack", fontStack(look.display));
  s.setProperty("--font-mono-stack", fontStack(look.mono));
  s.setProperty("zoom", String(look.scale));
  const fx = fxOf(look);
  root.dataset.cursor = fx.cursor;
  root.dataset.covers = fx.covers;
  root.dataset.overlay = fx.overlay;
  s.setProperty("--ui-weight", String(fx.weight));
  let tag = document.getElementById("karasu-css");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "karasu-css";
    document.head.appendChild(tag);
  }
  if (tag.textContent !== fx.css) tag.textContent = fx.css;
}

export function assetUrl(id: string | null | undefined, size?: number) {
  if (!id) return undefined;
  return media(`/api/assets/${id}${size ? `?s=${size}` : ""}`);
}

export function useTint(): { filter?: string } {
  const art = useLook((s) => s.look.artAccent);
  return art ? {} : { filter: "grayscale(1)" };
}
