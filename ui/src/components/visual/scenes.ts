import { rgba, type RGB } from "./color";
import type { Pulse } from "./pulse";

export type SceneKind = "flow" | "ripples" | "mountains" | "ridges" | "smoke" | "aurora" | "warp" | "bloom" | "constellation";

export type SceneFrame = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dt: number;
  t: number;
  bands: Float32Array;
  pulse: Pulse;
  color: RGB;
  dark: boolean;
};

export type Painter = (f: SceneFrame) => void;

const TAU = Math.PI * 2;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function hash(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function sample(values: ArrayLike<number>, u: number) {
  const pos = Math.min(1, Math.max(0, u)) * (values.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return values[i] * (1 - f) + values[Math.min(values.length - 1, i + 1)] * f;
}

function fade(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${amount})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

function flow(): Painter {
  let pts: Float32Array | null = null;
  return ({ ctx, w, h, dt, t, pulse, color }) => {
    const count = Math.round(Math.min(2400, Math.max(300, (w * h) / 700)));
    if (!pts || pts.length !== count * 2) {
      pts = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        pts[i * 2] = Math.random() * w;
        pts[i * 2 + 1] = Math.random() * h;
      }
    }
    fade(ctx, w, h, 0.045 + (1 - pulse.energy) * 0.03);
    const v = 30 * (1 + pulse.energy * 2.2 + pulse.beat * 1.6);
    const s = 2.6 / Math.max(w, h);
    const warp = pulse.bass * 2.4;
    ctx.strokeStyle = rgba(color, 0.1 + pulse.energy * 0.32 + pulse.beat * 0.12);
    ctx.lineWidth = 1 + pulse.beat * 0.5;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      const a = (Math.sin(x * s + t * 0.2) + Math.cos(y * s * 1.3 - t * 0.15) + Math.sin((x + y) * s * 0.5 + warp)) * Math.PI;
      const nx = x + Math.cos(a) * v * dt;
      const ny = y + Math.sin(a) * v * dt;
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      if (nx < 0 || nx > w || ny < 0 || ny > h || Math.random() < 0.002) {
        pts[i * 2] = Math.random() * w;
        pts[i * 2 + 1] = Math.random() * h;
      } else {
        pts[i * 2] = nx;
        pts[i * 2 + 1] = ny;
      }
    }
    ctx.stroke();
  };
}

type Ring = { x: number; y: number; r: number; max: number; speed: number; width: number; alpha: number };

function ripples(): Painter {
  const rings: Ring[] = [];
  let quiet = 0;
  const drop = (w: number, h: number, size: number, strength: number) => {
    const x = rand(w * 0.08, w * 0.92);
    const y = rand(h * 0.12, h * 0.9);
    const max = Math.min(w, h) * size;
    for (let k = 0; k < 3; k++)
      rings.push({ x, y, r: -k * max * 0.09, max, speed: max * (0.42 + strength * 0.25), width: 1 + strength * 1.8 - k * 0.4, alpha: (0.5 + strength * 0.4) * (1 - k * 0.28) });
  };
  return ({ ctx, w, h, dt, pulse, color }) => {
    ctx.clearRect(0, 0, w, h);
    if (pulse.hit) drop(w, h, 0.22 + pulse.bass * 0.3, Math.min(1, 0.4 + pulse.energy));
    if (pulse.live && Math.random() < dt * pulse.high * 3) drop(w, h, rand(0.04, 0.09), 0.2);
    quiet = pulse.live ? 0 : quiet + dt;
    if (quiet > 2.4) {
      quiet = 0;
      drop(w, h, 0.12, 0.25);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      ring.r += ring.speed * dt;
      if (ring.r >= ring.max) {
        rings.splice(i, 1);
        continue;
      }
      if (ring.r <= 0) continue;
      const life = 1 - ring.r / ring.max;
      ctx.beginPath();
      ctx.ellipse(ring.x, ring.y, ring.r, ring.r * 0.42, 0, 0, TAU);
      ctx.strokeStyle = rgba(color, ring.alpha * life * life);
      ctx.lineWidth = Math.max(0.5, ring.width * life);
      ctx.stroke();
    }
    if (rings.length > 240) rings.splice(0, rings.length - 240);
  };
}

function mountains(): Painter {
  const layers = 4;
  const level = Array.from({ length: layers }, () => new Float32Array(12));
  let ridge = new Float32Array(0);
  let travel = 0;
  return ({ ctx, w, h, dt, bands, pulse, color }) => {
    ctx.clearRect(0, 0, w, h);
    travel += dt * (6 + pulse.energy * 22);
    const m = Math.min(w, h);
    const mx = w * 0.74;
    const my = h * 0.2;
    const mr = m * 0.045 * (1 + pulse.beat * 0.06);
    const reach = mr * (4 + pulse.bass * 2.5);
    const glow = ctx.createRadialGradient(mx, my, mr * 0.7, mx, my, reach);
    glow.addColorStop(0, rgba(color, 0.12 + pulse.energy * 0.1));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(mx - reach, my - reach, reach * 2, reach * 2);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fillStyle = rgba(color, 0.42);
    ctx.fill();
    const step = Math.max(4, w / 220);
    const count = Math.ceil(w / step) + 2;
    if (ridge.length !== count) ridge = new Float32Array(count);
    for (let L = 0; L < layers; L++) {
      const depth = L / (layers - 1);
      const lv = level[L];
      const ease = 1 - Math.exp(-dt * (2.5 + depth * 6));
      for (let i = 0; i < 12; i++) lv[i] += ((pulse.live ? sample(bands, (i / 11) * 0.6) : 0) - lv[i]) * ease;
      const base = h * (0.4 + depth * 0.24);
      const amp = h * (0.06 + depth * 0.06);
      const shift = travel * (0.2 + depth * 0.8);
      const freq = 1 / (w * (0.3 - depth * 0.08));
      for (let p = 0; p < count; p++) {
        const x = p * step;
        const u = Math.min(1, Math.abs(x / w - 0.5) * 2);
        const shape = noise((x + shift) * freq + L * 17.3, L * 5.1) * 0.72 + noise((x + shift) * freq * 2.3 + L * 3.1, L + 0.5) * 0.28;
        ridge[p] = base - shape * amp * 1.8 - sample(lv, u) * amp * (0.35 + depth * 0.5) * (1 - u * 0.5);
      }
      const foot = base + amp * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, ridge[0]);
      for (let p = 1; p < count; p++) ctx.lineTo(p * step, ridge[p]);
      ctx.lineTo((count - 1) * step, foot);
      ctx.lineTo(0, foot);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, base - amp * 1.8, 0, foot);
      g.addColorStop(0, rgba(color, 0.1 + depth * 0.14));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, ridge[0]);
      for (let p = 1; p < count; p++) ctx.lineTo(p * step, ridge[p]);
      ctx.strokeStyle = rgba(color, 0.22 + depth * 0.36);
      ctx.lineWidth = 1 + depth * 0.8;
      ctx.stroke();
    }
  };
}

function ridges(): Painter {
  const rows = 28;
  const points = 121;
  const history: { id: number; spec: Float32Array }[] = [];
  const ys = new Float32Array(points);
  let clock = 0;
  let next = 0;
  return ({ ctx, w, h, dt, bands, pulse, color }) => {
    clock += dt;
    if (clock >= 0.06 || !history.length) {
      clock = 0;
      const spec = new Float32Array(48);
      for (let i = 0; i < 48; i++) spec[i] = pulse.live ? sample(bands, (i / 47) * 0.8) : 0;
      history.unshift({ id: next++, spec });
      if (history.length > rows) history.pop();
    }
    ctx.clearRect(0, 0, w, h);
    const width = Math.min(w * 0.56, h * 0.95);
    const left = (w - width) / 2;
    const top = h * 0.22;
    const gap = (h * 0.6) / rows;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = "round";
    for (let r = rows - 1; r >= 0; r--) {
      const row = history[r];
      if (!row) continue;
      const y0 = top + (rows - 1 - r) * gap;
      for (let p = 0; p < points; p++) {
        const u = p / (points - 1);
        const env = Math.exp(-Math.pow((u - 0.5) / 0.17, 2));
        const wiggle = (noise(p * 0.35 + row.id * 3.7, row.id * 1.3) - 0.5) * 0.3;
        ys[p] = y0 - (sample(row.spec, Math.abs(u - 0.5) * 2) * 0.9 + wiggle * 0.3 + 0.05) * env * gap * 6;
      }
      ctx.beginPath();
      ctx.moveTo(left, ys[0]);
      for (let p = 1; p < points; p++) ctx.lineTo(left + (p / (points - 1)) * width, ys[p]);
      ctx.lineTo(left + width, y0 + gap * 0.4);
      ctx.lineTo(left, y0 + gap * 0.4);
      ctx.closePath();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.moveTo(left, ys[0]);
      for (let p = 1; p < points; p++) ctx.lineTo(left + (p / (points - 1)) * width, ys[p]);
      ctx.strokeStyle = rgba(color, 0.3 + (1 - r / rows) * 0.5);
      ctx.stroke();
    }
  };
}

type Puff = { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; seed: number };

function puffSprite(color: RGB) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 1));
    grad.addColorStop(0.5, rgba(color, 0.4));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return canvas;
}

function smoke(): Painter {
  const puffs: Puff[] = [];
  let sprite: HTMLCanvasElement | null = null;
  let tint = "";
  let carry = 0;
  return ({ ctx, w, h, dt, t, pulse, color }) => {
    if (!sprite || tint !== color.join()) {
      sprite = puffSprite(color);
      tint = color.join();
    }
    ctx.clearRect(0, 0, w, h);
    carry += dt * (10 + pulse.energy * 30);
    let burst = pulse.hit ? 6 + Math.round(pulse.bass * 10) : 0;
    while (carry >= 1 || burst > 0) {
      if (carry >= 1) carry -= 1;
      else burst--;
      const source = [0.24, 0.5, 0.78][Math.floor(Math.random() * 3)] * w;
      puffs.push({ x: source + rand(-30, 30), y: h + 30, vx: rand(-10, 10), vy: -rand(45, 80), r: rand(22, 40), life: 0, max: rand(6, 10), seed: Math.random() * 100 });
    }
    const lift = 1 + pulse.energy * 1.4;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life += dt;
      if (p.life > p.max || p.y < -p.r * 2) {
        puffs.splice(i, 1);
        continue;
      }
      const curl = (noise(p.x * 0.004 + p.seed, p.y * 0.004 - t * 0.15) - 0.5) * (60 + pulse.mid * 140);
      p.vx += (curl - p.vx) * Math.min(1, dt * 1.5);
      p.x += p.vx * dt;
      p.y += p.vy * dt * lift;
      p.r += dt * (16 + pulse.energy * 18);
      ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, (p.life / p.max) * 1.15)) * (0.06 + pulse.energy * 0.08);
      ctx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    if (puffs.length > 500) puffs.splice(0, puffs.length - 500);
  };
}

function aurora(): Painter {
  const cols = 110;
  const level = new Float32Array(cols);
  return ({ ctx, w, h, dt, t, bands, pulse, color, dark }) => {
    ctx.clearRect(0, 0, w, h);
    const colW = w / cols;
    const ease = 1 - Math.exp(-dt * 5);
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      level[c] += ((pulse.live ? sample(bands, 0.06 + Math.abs(u - 0.5) * 1.4) : 0.12) - level[c]) * ease;
      const top = h * (0.05 + noise(c * 0.05 + t * 0.15, t * 0.05) * 0.26);
      const len = h * (0.24 + level[c] * 0.42 + pulse.beat * 0.05);
      const x = c * colW + Math.sin(t * 0.4 + c * 0.13) * colW * 2;
      const a = 0.025 + level[c] * 0.1 + pulse.energy * 0.03;
      const g = ctx.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.3, rgba(color, a));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - colW, top, colW * 3, len);
    }
    ctx.globalCompositeOperation = "source-over";
  };
}

function warp(): Painter {
  let stars: Float32Array | null = null;
  const place = (s: Float32Array, i: number, z: number) => {
    s[i * 3] = (Math.random() - 0.5) * 2;
    s[i * 3 + 1] = (Math.random() - 0.5) * 2;
    s[i * 3 + 2] = z;
  };
  return ({ ctx, w, h, dt, pulse, color }) => {
    const count = Math.round(Math.min(1000, Math.max(200, (w * h) / 1500)));
    if (!stars || stars.length !== count * 3) {
      stars = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) place(stars, i, rand(0.05, 1));
    }
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const f = Math.max(w, h) * 0.5;
    const speed = 0.16 + pulse.energy * 0.6 + pulse.beat * 0.7;
    const streak = 0.02 + speed * 0.1;
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const z = stars[i * 3 + 2] - speed * dt;
      if (z <= 0.03) {
        place(stars, i, rand(0.7, 1));
        continue;
      }
      stars[i * 3 + 2] = z;
      const x = stars[i * 3];
      const y = stars[i * 3 + 1];
      const sx = cx + (x / z) * f;
      const sy = cy + (y / z) * f;
      if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) {
        place(stars, i, rand(0.7, 1));
        continue;
      }
      const tail = Math.min(1.2, z + streak);
      ctx.strokeStyle = rgba(color, Math.min(1, (1 - z) * 1.3) * (0.5 + pulse.energy * 0.5));
      ctx.lineWidth = Math.max(0.7, (1 - z) * 2.4);
      ctx.beginPath();
      ctx.moveTo(cx + (x / tail) * f, cy + (y / tail) * f);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  };
}

type Blot = { x: number; y: number; R: number; age: number; life: number; seed: number; grow: number; spots: number[] };

function bloom(): Painter {
  const blots: Blot[] = [];
  let quiet = 0;
  const spawn = (w: number, h: number, strength: number) => {
    const R = Math.min(w, h) * (0.05 + strength * 0.11);
    const spots: number[] = [];
    for (let k = 0; k < Math.floor(strength * 9); k++) {
      const a = Math.random() * TAU;
      const d = R * rand(1.15, 2.2);
      spots.push(Math.cos(a) * d, Math.sin(a) * d, R * rand(0.03, 0.09));
    }
    blots.push({ x: rand(w * 0.1, w * 0.9), y: rand(h * 0.12, h * 0.88), R, age: 0, life: rand(4, 7), seed: Math.random() * 1000, grow: rand(0.25, 0.45), spots });
    if (blots.length > 16) blots.shift();
  };
  return ({ ctx, w, h, dt, pulse, color }) => {
    ctx.clearRect(0, 0, w, h);
    if (pulse.hit) spawn(w, h, Math.min(1, 0.35 + pulse.bass * 0.8));
    quiet = pulse.live ? 0 : quiet + dt;
    if (quiet > 3) {
      quiet = 0;
      spawn(w, h, 0.3);
    }
    for (let i = blots.length - 1; i >= 0; i--) {
      const b = blots[i];
      b.age += dt;
      if (b.age > b.life) {
        blots.splice(i, 1);
        continue;
      }
      const open = 1 - Math.pow(1 - Math.min(1, b.age / b.grow), 3);
      const r = b.R * open * (1 + (b.age / b.life) * 0.18);
      const left = 1 - Math.pow(b.age / b.life, 2);
      ctx.beginPath();
      for (let s = 0; s <= 56; s++) {
        const a = (s / 56) * TAU;
        const edge = 1 + (noise(Math.cos(a) * 1.6 + b.seed, Math.sin(a) * 1.6 + b.seed) - 0.5) * 0.55 + (noise(Math.cos(a) * 5 + b.seed, Math.sin(a) * 5) - 0.5) * 0.18;
        const px = b.x + Math.cos(a) * r * edge;
        const py = b.y + Math.sin(a) * r * edge;
        if (s) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(1, r * 1.3));
      g.addColorStop(0, rgba(color, 0.42 * left));
      g.addColorStop(0.6, rgba(color, 0.22 * left));
      g.addColorStop(1, rgba(color, 0.05 * left));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = rgba(color, 0.35 * left);
      for (let k = 0; k < b.spots.length; k += 3) {
        ctx.beginPath();
        ctx.arc(b.x + b.spots[k] * open, b.y + b.spots[k + 1] * open, b.spots[k + 2], 0, TAU);
        ctx.fill();
      }
    }
  };
}

type Star = { hx: number; hy: number; vx: number; vy: number; ox: number; oy: number; kx: number; ky: number; x: number; y: number; r: number; tw: number };

function constellation(): Painter {
  const stars: Star[] = [];
  const buckets = 6;
  return ({ ctx, w, h, dt, t, pulse, color }) => {
    const count = Math.round(Math.min(160, Math.max(40, (w * h) / 9000)));
    while (stars.length < count) {
      const hx = rand(0, w);
      const hy = rand(0, h);
      stars.push({ hx, hy, vx: rand(-12, 12), vy: rand(-12, 12), ox: 0, oy: 0, kx: 0, ky: 0, x: hx, y: hy, r: rand(1.1, 2.4), tw: rand(0, TAU) });
    }
    if (stars.length > count) stars.length = count;
    ctx.clearRect(0, 0, w, h);
    const reach = Math.min(w, h) * 0.2;
    const pace = 1 + pulse.energy * 2.5;
    for (const s of stars) {
      s.hx = (s.hx + s.vx * dt * pace + w) % w;
      s.hy = (s.hy + s.vy * dt * pace + h) % h;
      if (pulse.hit) {
        const dx = s.hx - w / 2;
        const dy = s.hy - h / 2;
        const d = Math.hypot(dx, dy) || 1;
        s.kx += (dx / d) * 260 * (0.4 + pulse.bass);
        s.ky += (dy / d) * 260 * (0.4 + pulse.bass);
      }
      s.kx += (-s.ox * 40 - s.kx * 9) * dt;
      s.ky += (-s.oy * 40 - s.ky * 9) * dt;
      s.ox += s.kx * dt;
      s.oy += s.ky * dt;
      s.x = s.hx + s.ox;
      s.y = s.hy + s.oy;
    }
    const strength = 0.18 + pulse.energy * 0.35 + pulse.beat * 0.2;
    const paths = Array.from({ length: buckets }, () => new Path2D());
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const k = Math.min(buckets - 1, Math.floor((1 - Math.sqrt(d2) / reach) * buckets));
        paths[k].moveTo(a.x, a.y);
        paths[k].lineTo(b.x, b.y);
      }
    }
    ctx.lineWidth = 1.2;
    for (let k = 0; k < buckets; k++) {
      ctx.strokeStyle = rgba(color, ((k + 0.5) / buckets) * strength);
      ctx.stroke(paths[k]);
    }
    for (const s of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + s.tw);
      ctx.fillStyle = rgba(color, 0.6 + twinkle * 0.3 * (0.5 + pulse.high));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1.3 + pulse.beat), 0, TAU);
      ctx.fill();
    }
  };
}

export const SCENES: { value: SceneKind; label: string; hint: string; make: () => Painter; blur?: number }[] = [
  { value: "flow", label: "Ink flow", hint: "Ink currents that speed up and swirl with the song", make: flow },
  { value: "ripples", label: "Ripples", hint: "Every beat drops a ripple on still water", make: ripples },
  { value: "mountains", label: "Ink mountains", hint: "Misty ridges that rise with the bass", make: mountains },
  { value: "ridges", label: "Ridgelines", hint: "The sound drawn as rolling lines, newest in front", make: ridges },
  { value: "smoke", label: "Incense smoke", hint: "Smoke that curls and thickens on loud parts", make: smoke, blur: 7 },
  { value: "aurora", label: "Light curtains", hint: "Soft curtains that brighten with each frequency", make: aurora, blur: 4 },
  { value: "warp", label: "Warp", hint: "Stars rush past faster as the song builds", make: warp },
  { value: "bloom", label: "Ink bloom", hint: "Ink drops bloom on the paper with every beat", make: bloom },
  { value: "constellation", label: "Constellation", hint: "Stars link up and scatter on the beat", make: constellation },
];

export function makeScene(kind: string): Painter {
  return (SCENES.find((s) => s.value === kind) ?? SCENES[0]).make();
}

export function sceneBlur(kind: string) {
  const blur = SCENES.find((s) => s.value === kind)?.blur;
  return blur ? `blur(${blur}px)` : undefined;
}
