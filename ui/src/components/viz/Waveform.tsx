import { useEffect, useRef } from "react";
import { BANDS, readLevels, useSystemAudio } from "../../player/levels";
import { usePrefs } from "../../store/prefs";
import { cn } from "../ui/cn";
import type { VizStyle } from "./styles";

export { VIZ_STYLES, type VizStyle } from "./styles";

export type WaveformOptions = {
  style?: VizStyle;
  bars?: number;
  gap?: number;
  sensitivity?: number;
  fall?: number;
  strands?: number;
  thickness?: number;
};

const fract = (x: number) => x - Math.floor(x);
const SEEDS = Array.from({ length: 256 }, (_, i) => fract(Math.sin(i * 12.9898 + 4.1) * 43758.5453));

export function Waveform({ className, ...options }: WaveformOptions & { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const opts = useRef(options);
  opts.current = options;
  const motion = usePrefs((s) => s.motion);
  useSystemAudio();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const raw = new Float32Array(BANDS);
    const level = new Float32Array(BANDS);
    const bandMax = new Float32Array(BANDS);
    const shape = new Float32Array(BANDS);
    const spread = new Float32Array(BANDS);
    const history: number[] = [];
    let color = getComputedStyle(el).color;
    let colorAt = 0;
    let lastPush = 0;
    let phase = 0;
    let quiet = 0;
    let peak = 0.18;
    let drawn = "";
    let raf = 0;

    const pick = (arr: Float32Array, u: number) => {
      const pos = Math.min(1, Math.max(0, u)) * (BANDS - 1);
      const i = Math.floor(pos);
      const f = pos - i;
      return arr[i] * (1 - f) + arr[Math.min(BANDS - 1, i + 1)] * f;
    };
    const sample = (u: number) => pick(level, u);

    const lobe = (u: number) => {
      const a = u * Math.PI * 7 + phase;
      const s = Math.sin(a) * 0.72 + Math.sin(a * 2.3 + 1.1) * 0.28;
      return Math.sign(s) * Math.pow(Math.abs(s), 1.5);
    };

    const signed = (u: number) => pick(shape, u) * lobe(u) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.55);

    const normalize = () => {
      let top = 0;
      for (let k = 0; k <= 60; k++) top = Math.max(top, Math.abs(signed(k / 60)));
      peak += (top - peak) * (top > peak ? 0.35 : 0.02);
      return 0.9 / Math.max(peak, 0.18);
    };

    const draw = (now: number) => {
      const o = opts.current;
      const style = o.style ?? "bars";
      const sens = o.sensitivity ?? 1;
      const fall = o.fall ?? 0.12;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      if (now - colorAt > 1000) {
        color = getComputedStyle(el).color;
        colorAt = now;
      }
      const { rms, live } = readLevels(raw);
      let energy = 0;
      for (let i = 0; i < BANDS; i++) {
        const target = Math.min(1, raw[i] * sens);
        const k = motion === "off" ? 1 : target > level[i] ? 0.55 : fall;
        level[i] += (target - level[i]) * k;
        bandMax[i] = Math.max(level[i], bandMax[i] * 0.996);
        shape[i] = level[i] / Math.max(bandMax[i], 0.2);
        energy += level[i];
      }
      energy /= BANDS;
      if (live && now - lastPush > 45) {
        history.push(Math.min(1, rms * sens * 1.6));
        if (history.length > 600) history.splice(0, history.length - 600);
        lastPush = now;
      }
      phase += 0.004 + energy * 0.012;
      quiet = energy < 0.003 && !live ? quiet + 1 : 0;
      const key = `${style}|${o.bars}|${o.gap}|${o.thickness}|${o.strands}|${color}|${w}x${h}`;
      if (quiet > 90 && key === drawn) {
        raf = requestAnimationFrame(draw);
        return;
      }
      drawn = key;

      const mid = h / 2;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (style === "smoke") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgba(0,0,0,${motion === "off" ? 1 : 0.3})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
        const strands = Math.round(o.strands ?? 46);
        const points = 150;
        const thick = o.thickness ?? 1;
        const norm = normalize();
        for (let s = 0; s < strands; s++) {
          const r1 = SEEDS[s % SEEDS.length];
          const r2 = SEEDS[(s + 97) % SEEDS.length];
          const amp = (0.22 + 0.86 * r1) * (s % 9 === 0 ? 1.3 : 1);
          const shift = (r2 - 0.5) * 0.085;
          const wob = 0.02 + 0.06 * r2;
          ctx.globalAlpha = 0.05 + 0.14 * (1 - r1);
          ctx.lineWidth = dpr * (0.45 + 0.75 * r2) * thick;
          ctx.beginPath();
          for (let k = 0; k <= points; k++) {
            const u = k / points;
            const local = sample(u);
            const wobble = Math.sin(u * (8 + r1 * 12) + now * 0.0011 * (0.4 + r2) + s) * wob * local;
            const y = mid - (signed(u + shift) * amp * norm + wobble) * h * 0.47;
            if (k === 0) ctx.moveTo(u * w, y);
            else ctx.lineTo(u * w, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 0.85;
        for (const [scale, width] of [[0.55, 1.6], [0.66, 1]] as const) {
          ctx.lineWidth = width * dpr * thick;
          ctx.beginPath();
          for (let k = 0; k <= points; k++) {
            const u = k / points;
            const y = mid - signed(u) * scale * norm * h * 0.47;
            if (k === 0) ctx.moveTo(0, y);
            else ctx.lineTo(u * w, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.clearRect(0, 0, w, h);
        if (style === "bars" || style === "mirror") {
          for (let j = 0; j < BANDS; j++) {
            let v = level[j];
            for (let d = 1, f = 0.62; d <= 3; d++, f *= 0.62) {
              if (j - d >= 0) v = Math.max(v, level[j - d] * f);
              if (j + d < BANDS) v = Math.max(v, level[j + d] * f);
            }
            spread[j] = v;
          }
          const n = Math.max(2, Math.round(o.bars ?? 32));
          const slot = w / n;
          const bw = Math.max(dpr, slot * (1 - (o.gap ?? 0.3)));
          for (let i = 0; i < n; i++) {
            const v = pick(spread, i / (n - 1));
            const x = i * slot + (slot - bw) / 2;
            if (style === "bars") {
              const bh = v * h;
              if (bh >= dpr * 0.5) ctx.fillRect(x, h - bh, bw, bh);
            } else {
              const bh = (v * h) / 2;
              if (bh >= dpr * 0.5) ctx.fillRect(x, mid - bh, bw, bh * 2);
            }
          }
        } else if (style === "memo") {
          const thick = o.thickness ?? 1;
          const bw = Math.max(1, 2 * dpr * thick);
          const step = bw + 3 * dpr;
          const n = Math.floor(w / step);
          const recent = history.slice(-n);
          const offset = n - recent.length;
          for (let i = 0; i < n; i++) {
            const x = i * step + step / 2;
            const amp = i < offset ? 0 : recent[i - offset] * h * 0.46;
            if (amp < 1.4 * dpr) {
              ctx.beginPath();
              ctx.arc(x, mid, 0.9 * dpr * thick, 0, Math.PI * 2);
              ctx.fill();
            } else ctx.fillRect(x - bw / 2, mid - amp, bw, amp * 2);
          }
        } else {
          ctx.lineWidth = 1.6 * dpr * (o.thickness ?? 1);
          ctx.lineJoin = "round";
          ctx.beginPath();
          const points = 160;
          const norm = normalize();
          for (let k = 0; k <= points; k++) {
            const u = k / points;
            const y = mid - signed(u) * norm * h * 0.44;
            if (k === 0) ctx.moveTo(0, y);
            else ctx.lineTo(u * w, y);
          }
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [motion]);

  return <canvas ref={canvas} className={cn("block w-full", className ?? "h-full text-fg-0")} aria-hidden />;
}
