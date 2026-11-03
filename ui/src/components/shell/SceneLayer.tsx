import { useEffect, useMemo, useRef } from "react";
import { BANDS, readLevels, useSystemAudio } from "../../player/levels";
import { currentTrack, usePlayer } from "../../store/player";
import { usePrefs } from "../../store/prefs";
import { FX, useLook } from "../../theme/look";
import { toRgb } from "../visual/color";
import { Pulse } from "../visual/pulse";
import { makeScene, sceneBlur } from "../visual/scenes";

export function useSceneColor(tint: string) {
  const ink = useLook((s) => s.look.ink);
  const accent = useLook((s) => s.look.accent);
  const art = usePlayer((s) => currentTrack(s)?.art?.palette?.accent);
  return useMemo(() => {
    if (tint === "art" && art) return toRgb(art);
    if (tint === "accent") return toRgb(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || accent);
    return toRgb(ink);
  }, [tint, art, ink, accent]);
}

function SceneCanvas({ kind, strength, sense, tint }: { kind: string; strength: number; sense: number; tint: string }) {
  useSystemAudio();
  const ref = useRef<HTMLCanvasElement>(null);
  const color = useSceneColor(tint);
  const dark = useLook((s) => s.look.scheme) === "dark";
  const live = useRef({ color, sense, dark });
  live.current = { color, sense, dark };

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const paint = makeScene(kind);
    const pulse = new Pulse();
    const bands = new Float32Array(BANDS);
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || !w || !h) return;
      t += dt;
      const { rms } = readLevels(bands);
      pulse.sense = live.current.sense;
      pulse.update(bands, rms, dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint({ ctx, w, h, dt, t, bands, pulse, color: live.current.color, dark: live.current.dark });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [kind]);

  return <canvas ref={ref} aria-hidden data-scene={kind} className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: strength, filter: sceneBlur(kind) }} />;
}

export function SceneLayer() {
  const fx = { ...FX, ...(useLook((s) => s.look.fx) ?? {}) };
  const motion = usePrefs((s) => s.motion);
  if (fx.scene === "none" || motion === "off") return null;
  return <SceneCanvas kind={fx.scene} strength={fx.sceneStrength} sense={fx.sceneSense} tint={fx.sceneColor} />;
}
