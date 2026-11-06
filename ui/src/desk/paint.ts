import { useMemo } from "react";
import { rgba, toRgb, type RGB } from "../components/visual/color";
import { currentTrack, usePlayer } from "../store/player";
import { useLook } from "../theme/look";
import type { Item } from "./types";

export type Paint = {
  a: RGB;
  b: RGB;
  gradient: boolean;
  // "along" runs the gradient across the bars, "out" from quiet to loud.
  dir: "along" | "out";
  glow: number;
  key: string;
};

export const PAINT_MODES: [string, string][] = [
  ["ink", "Theme ink"],
  ["accent", "Accent"],
  ["art", "Album art"],
  ["custom", "Pick a color"],
  ["gradient", "Gradient"],
];

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

export function shade(p: Paint, t: number): RGB {
  if (!p.gradient) return p.a;
  const k = Math.max(0, Math.min(1, t));
  return [lerp(p.a[0], p.b[0], k), lerp(p.a[1], p.b[1], k), lerp(p.a[2], p.b[2], k)];
}

// A canvas gradient for shapes drawn over the whole canvas. Mirrored styles grow from the middle out.
export function paintFill(ctx: CanvasRenderingContext2D, p: Paint, w: number, h: number, from: "bottom" | "middle") {
  if (!p.gradient) return rgba(p.a, 1);
  if (p.dir === "along") {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgba(p.a, 1));
    g.addColorStop(1, rgba(p.b, 1));
    return g;
  }
  const g = ctx.createLinearGradient(0, h, 0, 0);
  if (from === "bottom") {
    g.addColorStop(0, rgba(p.a, 1));
    g.addColorStop(1, rgba(p.b, 1));
  } else {
    g.addColorStop(0, rgba(p.b, 1));
    g.addColorStop(0.5, rgba(p.a, 1));
    g.addColorStop(1, rgba(p.b, 1));
  }
  return g;
}

export function glowOn(ctx: CanvasRenderingContext2D, p: Paint, dpr = 1) {
  ctx.shadowBlur = p.glow > 0 ? p.glow * 22 * dpr : 0;
  ctx.shadowColor = p.glow > 0 ? rgba(p.gradient ? p.b : p.a, 0.85) : "transparent";
}

export function usePaint(item: Item, fallback = "ink"): Paint {
  const ink = useLook((s) => s.look.ink);
  const accent = useLook((s) => s.look.accent);
  const palette = usePlayer((s) => currentTrack(s)?.art?.palette);
  const p = item.props;
  // Scenes and orbs saved before colors were shared keep their old "color" setting.
  const mode = String(p.paint ?? p.color ?? fallback);
  const first = typeof p.paintA === "string" ? p.paintA : null;
  const second = typeof p.paintB === "string" ? p.paintB : null;
  const dir = p.paintDir === "along" ? "along" : "out";
  const glow = Number(p.glow ?? 0) || 0;
  const own = item.style.color ?? null;
  return useMemo(() => {
    const theme = toRgb(own ?? ink);
    const acc = toRgb(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || accent);
    let a = theme;
    let b = theme;
    if (mode === "accent") a = b = acc;
    else if (mode === "art") a = b = palette ? toRgb(palette.accent) : theme;
    else if (mode === "custom") a = b = toRgb(first ?? own ?? ink);
    else if (mode === "gradient") {
      a = toRgb(first ?? own ?? ink);
      b = toRgb(second ?? accent);
    }
    const gradient = mode === "gradient";
    return { a, b, gradient, dir, glow, key: `${a}|${b}|${gradient}|${dir}|${glow}` };
  }, [mode, first, second, dir, glow, own, ink, accent, palette]);
}
