import type { Wallpaper } from "../../theme/look";

const SPOTS: Record<string, [number, number]> = { center: [50, 50], top: [50, 0], bottom: [50, 100], left: [0, 50], right: [100, 50] };

export function focus(wp: Wallpaper): [number, number] {
  const spot = SPOTS[wp.position] ?? SPOTS.center;
  return [wp.x ?? spot[0], wp.y ?? spot[1]];
}

export function fitSize(fit: Wallpaper["fit"], frameW: number, frameH: number, imageW: number, imageH: number, zoom: number) {
  const base = fit === "tile" ? 1 : fit === "contain" ? Math.min(frameW / imageW, frameH / imageH) : Math.max(frameW / imageW, frameH / imageH);
  return { w: imageW * base * zoom, h: imageH * base * zoom };
}

export function placed(fit: Wallpaper["fit"], frameW: number, frameH: number, imageW: number, imageH: number, wp: Wallpaper) {
  const size = fitSize(fit, frameW, frameH, imageW, imageH, wp.zoom ?? 1);
  const [x, y] = focus(wp);
  return { ...size, left: ((frameW - size.w) * x) / 100, top: ((frameH - size.h) * y) / 100 };
}
