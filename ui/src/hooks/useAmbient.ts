import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Palette, Track } from "../lib/types";
import { useLook } from "../theme/look";

const cache = new Map<string, Palette | null>();

export function usePalette(track: Track | null | undefined): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(track?.art?.palette ?? null);
  useEffect(() => {
    if (!track) {
      setPalette(null);
      return;
    }
    if (track.art?.palette) {
      setPalette(track.art.palette);
      return;
    }
    if (!track.art) {
      setPalette(null);
      return;
    }
    if (cache.has(track.id)) {
      setPalette(cache.get(track.id) ?? null);
      return;
    }
    let alive = true;
    api
      .trackPalette(track.id)
      .then((p) => {
        const value = p && "accent" in p ? (p as Palette) : null;
        cache.set(track.id, value);
        if (alive) setPalette(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [track?.id]);
  return palette;
}

export function useAmbientVars(palette: Palette | null) {
  const artAccent = useLook((s) => s.look.artAccent);
  useEffect(() => {
    const root = document.documentElement.style;
    if (palette && artAccent) {
      root.setProperty("--art-glow", palette.glow);
      root.setProperty("--art-base", palette.base);
      root.setProperty("--art-deep", palette.deep);
    } else {
      root.removeProperty("--art-glow");
      root.removeProperty("--art-base");
      root.removeProperty("--art-deep");
    }
    if (artAccent && palette) root.setProperty("--accent", palette.accent);
    else root.removeProperty("--accent");
  }, [palette?.accent, palette?.glow, artAccent]);
}
