import { useEffect, useRef } from "react";
import { BANDS, readLevels, useSystemAudio } from "../../player/levels";
import { usePrefs } from "../../store/prefs";
import { fxOf, useLook, type Particles } from "../../theme/look";
import { toRgb } from "../visual/color";

type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number; t: number; s: number };

const BASE: Record<Exclude<Particles, "none">, number> = { snow: 140, rain: 170, sakura: 46, fireflies: 38, dust: 130, stars: 230 };
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function spawn(kind: Particles, w: number, h: number, top: boolean): Mote {
  const y = top ? rand(-40, -4) : rand(0, h);
  switch (kind) {
    case "snow":
      return { x: rand(0, w), y, vx: 0, vy: rand(16, 48), r: rand(0.8, 2.8), a: rand(0.35, 0.9), t: rand(0, 6.3), s: Math.random() };
    case "rain":
      return { x: rand(-100, w + 100), y, vx: -110, vy: rand(620, 920), r: rand(9, 22), a: rand(0.14, 0.38), t: 0, s: 0 };
    case "sakura":
      return { x: rand(-w * 0.2, w), y, vx: rand(12, 34), vy: rand(18, 42), r: rand(3.2, 6.4), a: rand(0.45, 0.85), t: rand(0, 6.3), s: rand(-2.2, 2.2) };
    case "fireflies":
      return { x: rand(0, w), y: rand(0, h), vx: rand(-12, 12), vy: rand(-12, 12), r: rand(1.2, 2.4), a: rand(0.5, 1), t: rand(0, 6.3), s: rand(1.2, 2.6) };
    case "dust":
      return { x: rand(0, w), y: rand(0, h), vx: rand(-7, 7), vy: rand(-7, 7), r: rand(0.4, 1.3), a: rand(0.12, 0.42), t: 0, s: 0 };
    default:
      return { x: rand(0, w), y: rand(0, h), vx: 0, vy: 0, r: rand(0.3, 1.4), a: rand(0.3, 1), t: rand(0, 6.3), s: rand(0.6, 2.4) };
  }
}

function Field({ kind, density, speed, react, ink }: { kind: Particles; density: number; speed: number; react: boolean; ink: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ density, speed, react });
  opts.current = { density, speed, react };
  useSystemAudio();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const [r, g, b] = toRgb(ink);
    const color = (a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
    const motes: Mote[] = [];
    const levels = new Float32Array(BANDS);
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    let energy = 0;
    let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !w) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const o = opts.current;
      const rms = o.react ? readLevels(levels).rms : 0;
      energy += (Math.min(1, rms * 1.4) - energy) * 0.08;
      const pace = o.speed * (1 + energy * 1.4);
      const want = Math.round(BASE[kind as Exclude<Particles, "none">] * o.density * ((w * h) / 1.44e6));
      while (motes.length < want) motes.push(spawn(kind, w, h, false));
      if (motes.length > want) motes.length = want;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const time = now / 1000;
      for (let i = 0; i < motes.length; i++) {
        const p = motes[i];
        if (kind === "snow") {
          p.x += Math.sin(time * 0.8 + p.s * 6) * 14 * dt * o.speed;
          p.y += p.vy * dt * pace;
          if (p.y > h + 6) motes[i] = spawn(kind, w, h, true);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = color(p.a);
          ctx.fill();
        } else if (kind === "rain") {
          p.x += p.vx * dt * pace;
          p.y += p.vy * dt * pace;
          if (p.y > h + 20) motes[i] = spawn(kind, w, h, true);
          const len = p.r * (1 + energy * 0.6);
          const norm = Math.hypot(p.vx, p.vy);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - (p.vx / norm) * len, p.y - (p.vy / norm) * len);
          ctx.strokeStyle = color(p.a);
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (kind === "sakura") {
          p.t += p.s * dt * o.speed;
          p.x += (p.vx + Math.sin(time * 0.7 + p.s * 3) * 22) * dt * pace;
          p.y += p.vy * dt * pace;
          if (p.y > h + 12 || p.x > w + 12) motes[i] = spawn(kind, w, h, true);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.t);
          ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(p.t * 1.6)));
          ctx.beginPath();
          ctx.moveTo(0, -p.r);
          ctx.bezierCurveTo(p.r, -p.r * 0.6, p.r * 0.8, p.r * 0.7, 0, p.r);
          ctx.bezierCurveTo(-p.r * 0.8, p.r * 0.7, -p.r, -p.r * 0.6, 0, -p.r);
          ctx.fillStyle = color(p.a * 0.8);
          ctx.fill();
          ctx.restore();
        } else if (kind === "fireflies") {
          p.vx = Math.max(-22, Math.min(22, p.vx + rand(-30, 30) * dt));
          p.vy = Math.max(-22, Math.min(22, p.vy + rand(-30, 30) * dt));
          p.x = (p.x + p.vx * dt * pace + w) % w;
          p.y = (p.y + p.vy * dt * pace + h) % h;
          const glow = p.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * p.s + p.t))) * (1 + energy * 0.8);
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
          halo.addColorStop(0, color(glow * 0.55));
          halo.addColorStop(1, color(0));
          ctx.fillStyle = halo;
          ctx.fillRect(p.x - p.r * 7, p.y - p.r * 7, p.r * 14, p.r * 14);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = color(Math.min(1, glow + 0.2));
          ctx.fill();
        } else if (kind === "dust") {
          p.x = (p.x + p.vx * dt * pace + w) % w;
          p.y = (p.y + p.vy * dt * pace + h) % h;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = color(p.a * (1 + energy));
          ctx.fill();
        } else {
          const twinkle = p.a * (0.55 + 0.45 * Math.sin(time * p.s + p.t)) * (1 + energy * 0.6);
          ctx.fillStyle = color(twinkle);
          ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
        }
      }
      if (kind === "stars") {
        if (!shooting && Math.random() < dt * 0.09 * o.speed) {
          shooting = { x: rand(0, w * 0.7), y: rand(0, h * 0.4), vx: rand(500, 800), vy: rand(160, 300), life: 1 };
        }
        if (shooting) {
          shooting.life -= dt * 1.4;
          shooting.x += shooting.vx * dt;
          shooting.y += shooting.vy * dt;
          const tail = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 0.18, shooting.y - shooting.vy * 0.18);
          tail.addColorStop(0, color(0.9 * shooting.life));
          tail.addColorStop(1, color(0));
          ctx.beginPath();
          ctx.moveTo(shooting.x, shooting.y);
          ctx.lineTo(shooting.x - shooting.vx * 0.18, shooting.y - shooting.vy * 0.18);
          ctx.strokeStyle = tail;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          if (shooting.life <= 0) shooting = null;
        }
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [kind, ink]);

  return <canvas ref={canvas} data-weather={kind} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

export function Ambient() {
  const look = useLook((s) => s.look);
  const motion = usePrefs((s) => s.motion);
  const fx = fxOf(look);
  if (fx.particles === "none" || motion === "off") return null;
  return <Field kind={fx.particles} density={fx.density} speed={fx.speed} react={fx.react} ink={look.ink} />;
}
