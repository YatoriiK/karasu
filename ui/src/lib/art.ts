import { media } from "./api";
import type { Art } from "./types";

export function artUrl(art: Art | null | undefined, px: number): string | undefined {
  if (!art) return undefined;
  const sizes = [64, 160, 320, 640, 1000];
  const want = px * Math.min(window.devicePixelRatio || 1, 2);
  const size = sizes.find((s) => s >= want) ?? 1000;
  return media(`/api/art/${art.kind}/${art.ref}?s=${size}&v=2`);
}

export function spotifyArt(image: string | null | undefined): Art | null {
  if (!image || !image.includes("/image/")) return null;
  const ref = image.slice(image.lastIndexOf("/") + 1);
  return { kind: "sp", ref, src: `/api/art/sp/${ref}?s=320`, palette: null };
}

export function placeholderGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, oklch(0.32 0.06 ${h}), oklch(0.2 0.03 ${(h + 60) % 360}))`;
}
