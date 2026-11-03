import { useEffect, useMemo, useRef } from "react";
import { geoContains, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry, MultiLineString } from "geojson";
import { useReducedMotion } from "motion/react";
import atlas from "world-atlas/countries-110m.json";
import web from "./mesh.json";
import { useLook } from "../../theme/look";
import { usePrefs } from "../../store/prefs";
import { cn } from "../ui/cn";

export type GlobePoint = { key: string; lat: number; lon: number; value: number; label: string; detail: string };

type RGB = [number, number, number];
type Vec = [number, number, number];
type World = {
  land: FeatureCollection | Feature;
  countries: Feature<Geometry, { name: string }>[];
  borders: MultiLineString;
  graticule: MultiLineString;
  xyz: Float32Array;
  edges: Uint16Array;
};
type View = { lon: number; lat: number };
type Fly = { from: View; to: View; start: number; dur: number };

const RAD = Math.PI / 180;
const SPHERE = 0.4;
let world: World | null = null;

function getWorld(): World {
  if (world) return world;
  const topo = atlas as unknown as Topology<{ land: GeometryCollection; countries: GeometryCollection<{ name: string }> }>;
  const pts = web.points;
  const xyz = new Float32Array((pts.length / 2) * 3);
  for (let i = 0; i < pts.length / 2; i++) {
    const lon = pts[i * 2] * RAD;
    const lat = pts[i * 2 + 1] * RAD;
    xyz[i * 3] = Math.cos(lat) * Math.cos(lon);
    xyz[i * 3 + 1] = Math.cos(lat) * Math.sin(lon);
    xyz[i * 3 + 2] = Math.sin(lat);
  }
  world = {
    land: feature(topo, topo.objects.land),
    countries: feature(topo, topo.objects.countries).features as Feature<Geometry, { name: string }>[],
    borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
    graticule: geoGraticule10(),
    xyz,
    edges: Uint16Array.from(web.edges),
  };
  return world;
}

let probe: CanvasRenderingContext2D | null = null;

function toRgb(color: string, fallback: RGB): RGB {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function unit(lon: number, lat: number): Vec {
  const l = lon * RAD;
  const p = lat * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

function basis(view: View) {
  const l = view.lon * RAD;
  const p = view.lat * RAD;
  const cl = Math.cos(l);
  const sl = Math.sin(l);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  return { c: [cp * cl, cp * sl, sp] as Vec, e: [-sl, cl, 0] as Vec, n: [-sp * cl, -sp * sl, cp] as Vec };
}

function focusView(lon: number, lat: number): View {
  return { lon, lat: clamp(lat - (lat < 0 ? 10 : 18), -42, 62) };
}

type Scene = {
  points: GlobePoint[];
  shaded: { feature: Feature; share: number }[];
  active: string | null;
  hover: string | null;
  ink: RGB;
  paper: RGB;
  dark: boolean;
  glow: number;
  font: string;
  pulse: boolean;
};

type Marker = { key: string; x: number; y: number; tx: number; ty: number; z: number };

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: number, view: View, scene: Scene, now: number): Marker[] {
  const geo = getWorld();
  const { ink, paper, glow } = scene;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * SPHERE;
  ctx.clearRect(0, 0, w, h);

  const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.32);
  halo.addColorStop(0, rgba(ink, 0.2 * glow));
  halo.addColorStop(0.3, rgba(ink, 0.06 * glow));
  halo.addColorStop(1, rgba(ink, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = rgba(paper, 1);
  ctx.fill();
  const body = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.45, R * 0.05, cx, cy, R * 1.04);
  body.addColorStop(0, rgba(ink, 0.15));
  body.addColorStop(0.5, rgba(ink, 0.05));
  body.addColorStop(1, rgba(ink, 0.015));
  ctx.fillStyle = body;
  ctx.fill();

  const front = geoOrthographic().scale(R).translate([cx, cy]).rotate([-view.lon, -view.lat]).clipAngle(90).precision(0.7);
  const back = geoOrthographic().scale(R).translate([cx, cy]).rotate([-view.lon + 180, view.lat]).reflectX(true).clipAngle(90).precision(0.9);
  const path = geoPath(front, ctx);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  geoPath(back, ctx)(geo.land);
  ctx.strokeStyle = rgba(ink, 0.08);
  ctx.lineWidth = 0.8 * s;
  ctx.stroke();

  ctx.beginPath();
  path(geo.graticule);
  ctx.strokeStyle = rgba(ink, 0.055);
  ctx.lineWidth = 0.6 * s;
  ctx.stroke();

  for (const { feature: f, share } of scene.shaded) {
    ctx.beginPath();
    path(f);
    ctx.fillStyle = rgba(ink, 0.05 + 0.14 * share);
    ctx.fill();
  }

  const { c, e, n } = basis(view);
  const count = geo.xyz.length / 3;
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = geo.xyz[i * 3];
    const y = geo.xyz[i * 3 + 1];
    const z = geo.xyz[i * 3 + 2];
    sx[i] = cx + R * (x * e[0] + y * e[1] + z * e[2]);
    sy[i] = cy - R * (x * n[0] + y * n[1] + z * n[2]);
    sz[i] = x * c[0] + y * c[1] + z * c[2];
  }
  const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for (let k = 0; k < geo.edges.length; k += 2) {
    const a = geo.edges[k];
    const b = geo.edges[k + 1];
    const z = Math.min(sz[a], sz[b]);
    if (z <= 0.03) continue;
    const p = buckets[z > 0.72 ? 3 : z > 0.45 ? 2 : z > 0.2 ? 1 : 0];
    p.moveTo(sx[a], sy[a]);
    p.lineTo(sx[b], sy[b]);
  }
  ctx.lineWidth = 0.65 * s;
  buckets.forEach((p, i) => {
    ctx.strokeStyle = rgba(ink, [0.07, 0.13, 0.2, 0.27][i]);
    ctx.stroke(p);
  });
  const dots = new Path2D();
  const d = 1.3 * s;
  for (let i = 0; i < count; i++) {
    if (sz[i] > 0.15) dots.rect(sx[i] - d / 2, sy[i] - d / 2, d, d);
  }
  ctx.fillStyle = rgba(ink, 0.42);
  ctx.fill(dots);

  ctx.beginPath();
  path(geo.borders);
  ctx.strokeStyle = rgba(ink, 0.14);
  ctx.lineWidth = 0.6 * s;
  ctx.stroke();

  ctx.beginPath();
  path(geo.land);
  ctx.strokeStyle = rgba(ink, 0.1 + 0.08 * glow);
  ctx.lineWidth = 4.2 * s;
  ctx.stroke();
  ctx.strokeStyle = rgba(ink, 0.95);
  ctx.lineWidth = 1.15 * s;
  ctx.stroke();

  const rim = ctx.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
  rim.addColorStop(0, rgba(ink, 0));
  rim.addColorStop(1, rgba(ink, 0.12));
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.36);
  ctx.lineWidth = 1 * s;
  ctx.stroke();

  const glare = ctx.createRadialGradient(cx - R * 0.46, cy - R * 0.55, 0, cx - R * 0.46, cy - R * 0.55, R * 0.8);
  glare.addColorStop(0, `rgba(255,255,255,${(scene.dark ? 0.34 : 0.5) * (0.5 + glow)})`);
  glare.addColorStop(0.35, `rgba(255,255,255,${(scene.dark ? 0.08 : 0.16) * (0.5 + glow)})`);
  glare.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = scene.dark ? "lighter" : "source-over";
  ctx.fillStyle = glare;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  ctx.strokeStyle = rgba(ink, 0.4);
  ctx.lineWidth = 1.3 * s;
  const B = R * 1.17;
  for (const side of [-1, 1]) {
    const mid = side < 0 ? Math.PI : 0;
    ctx.beginPath();
    ctx.arc(cx, cy, B, mid - 0.4, mid + 0.4);
    ctx.stroke();
    for (const end of [-0.4, 0.4]) {
      const x = cx + B * Math.cos(mid + end);
      const y = cy + B * Math.sin(mid + end);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + side * R * 0.07, y);
      ctx.stroke();
    }
  }

  const markers: Marker[] = [];
  const max = Math.max(1, ...scene.points.map((p) => p.value));
  const order = scene.points.map((p, i) => ({ p, i })).sort((a, b) => a.p.value - b.p.value);
  for (const { p, i } of order) {
    const u = unit(p.lon, p.lat);
    const x = cx + R * (u[0] * e[0] + u[1] * e[1] + u[2] * e[2]);
    const y = cy - R * (u[0] * n[0] + u[1] * n[1] + u[2] * n[2]);
    const z = u[0] * c[0] + u[1] * c[1] + u[2] * c[2];
    const v = Math.sqrt(p.value / max);
    if (z <= 0) {
      ctx.beginPath();
      ctx.arc(x, y, 2 * s, 0, Math.PI * 2);
      ctx.fillStyle = rgba(ink, 0.16);
      ctx.fill();
      continue;
    }
    const fade = clamp(z / 0.22, 0, 1);
    const lift = 0.07 + 0.24 * v;
    const tx = cx + (x - cx) * (1 + lift);
    const ty = cy + (y - cy) * (1 + lift);
    const on = p.key === scene.active || p.key === scene.hover;
    const r = (2.4 + 2.8 * v) * s * (on ? 1.25 : 1);
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    bloom.addColorStop(0, rgba(ink, 0.45 * fade));
    bloom.addColorStop(1, rgba(ink, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    if (scene.pulse) {
      const phase = (now / 2400 + i * 0.19) % 1;
      ctx.beginPath();
      ctx.arc(x, y, r + phase * 18 * s, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ink, (1 - phase) * 0.55 * fade);
      ctx.lineWidth = 1 * s;
      ctx.stroke();
    }
    const beam = ctx.createLinearGradient(x, y, tx, ty);
    beam.addColorStop(0, rgba(ink, 0.95 * fade));
    beam.addColorStop(1, rgba(ink, 0.15 * fade));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = beam;
    ctx.lineWidth = (on ? 2.2 : 1.5) * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, (on ? 2.6 : 1.8) * s, 0, Math.PI * 2);
    ctx.fillStyle = rgba(ink, fade);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(ink, fade);
    ctx.fill();
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = rgba(paper, 0.9 * fade);
    ctx.stroke();
    ctx.font = `600 ${9.5 * s}px ${scene.font}`;
    ctx.fillStyle = rgba(ink, 0.8 * fade);
    ctx.textBaseline = "middle";
    ctx.fillText(String(scene.points.indexOf(p) + 1), x + r + 3 * s, y + r + 2 * s);
    markers.push({ key: p.key, x, y, tx, ty, z });
  }

  const label = scene.points.find((p) => p.key === (scene.hover ?? scene.active));
  const spot = label && markers.find((m) => m.key === label.key);
  if (label && spot) {
    const title = label.label;
    const detail = label.detail;
    ctx.font = `600 ${11.5 * s}px ${scene.font}`;
    const tw = ctx.measureText(title).width;
    ctx.font = `${10.5 * s}px ${scene.font}`;
    const dw = ctx.measureText(detail).width;
    const pad = 7 * s;
    const bw = Math.max(tw, dw) + pad * 2;
    const bh = 36 * s;
    const right = spot.tx >= cx;
    let bx = right ? spot.tx + 8 * s : spot.tx - 8 * s - bw;
    let by = spot.ty - bh / 2;
    bx = clamp(bx, 4 * s, w - bw - 4 * s);
    by = clamp(by, 4 * s, h - bh - 4 * s);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6 * s);
    ctx.fillStyle = rgba(paper, 0.88);
    ctx.fill();
    ctx.strokeStyle = rgba(ink, 0.35);
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.fillStyle = rgba(ink, 1);
    ctx.textBaseline = "alphabetic";
    ctx.font = `600 ${11.5 * s}px ${scene.font}`;
    ctx.fillText(title, bx + pad, by + 15 * s);
    ctx.fillStyle = rgba(ink, 0.65);
    ctx.font = `${10.5 * s}px ${scene.font}`;
    ctx.fillText(detail, bx + pad, by + 29 * s);
  }
  return markers;
}

export function Globe({
  points,
  active,
  onActive,
  focus,
  label,
  className,
}: {
  points: GlobePoint[];
  active: string | null;
  onActive?: (key: string) => void;
  focus: { key: string; at: number } | null;
  label: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const look = useLook((s) => s.look);
  const motion = usePrefs((s) => s.motion);
  const osReduced = useReducedMotion();
  const mode = osReduced || motion === "off" ? "off" : motion;
  const live = useRef({
    view: { lon: -40, lat: 22 } as View,
    vel: { lon: 0, lat: 0 },
    fly: null as Fly | null,
    drag: null as { x: number; y: number; view: View; moved: number; t: number } | null,
    idle: 0,
    hover: null as string | null,
    markers: [] as Marker[],
    dirty: true,
    scene: null as Scene | null,
    size: { w: 0, h: 0, s: 1 },
    onActive,
  });
  live.current.onActive = onActive;

  const shaded = useMemo(() => {
    const geo = getWorld();
    const totals = new Map<number, number>();
    for (const p of points) {
      const idx = geo.countries.findIndex((f) => geoContains(f, [p.lon, p.lat]));
      if (idx >= 0) totals.set(idx, (totals.get(idx) ?? 0) + p.value);
    }
    const top = Math.max(1, ...totals.values());
    return [...totals].map(([idx, v]) => ({ feature: geo.countries[idx] as Feature, share: v / top }));
  }, [points]);

  useEffect(() => {
    const fonts = getComputedStyle(document.documentElement).getPropertyValue("--font-mono-stack").trim() || "monospace";
    live.current.scene = {
      points,
      shaded,
      active,
      hover: live.current.hover,
      ink: toRgb(look.ink, [236, 235, 230]),
      paper: toRgb(look.paper, [5, 5, 5]),
      dark: look.scheme === "dark",
      glow: clamp(look.glow, 0, 1),
      font: fonts,
      pulse: mode === "full",
    };
    live.current.dirty = true;
  }, [points, shaded, active, look.ink, look.paper, look.scheme, look.glow, look.mono, mode]);

  useEffect(() => {
    if (!focus) return;
    const p = points.find((x) => x.key === focus.key);
    if (!p) return;
    const state = live.current;
    const to = focusView(p.lon, p.lat);
    let dl = ((to.lon - state.view.lon + 540) % 360) - 180;
    if (Math.abs(dl) < 0.01 && Math.abs(to.lat - state.view.lat) < 0.01) return;
    const from = { ...state.view };
    dl = from.lon + dl;
    state.vel = { lon: 0, lat: 0 };
    if (mode === "off") {
      state.view = { lon: dl, lat: to.lat };
      state.fly = null;
      state.dirty = true;
    } else {
      state.fly = { from, to: { lon: dl, lat: to.lat }, start: performance.now(), dur: mode === "full" ? 1400 : 450 };
    }
  }, [focus, points, mode]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const state = live.current;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let tick = 0;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      state.size = { w, h, s: dpr * (rect.width / Math.max(1, el.clientWidth || rect.width)) };
      state.dirty = true;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      tick++;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let moving = false;
      let ambient = !!state.scene?.pulse && state.scene.points.length > 0;
      if (state.fly) {
        const k = clamp((now - state.fly.start) / state.fly.dur, 0, 1);
        const t = ease(k);
        state.view = {
          lon: state.fly.from.lon + (state.fly.to.lon - state.fly.from.lon) * t,
          lat: state.fly.from.lat + (state.fly.to.lat - state.fly.from.lat) * t,
        };
        if (k >= 1) {
          state.fly = null;
          state.idle = now;
        }
        moving = true;
      } else if (!state.drag) {
        if (Math.abs(state.vel.lon) + Math.abs(state.vel.lat) > 0.5) {
          state.view = { lon: state.view.lon + state.vel.lon * dt, lat: clamp(state.view.lat + state.vel.lat * dt, -70, 70) };
          const decay = Math.pow(0.05, dt);
          state.vel = { lon: state.vel.lon * decay, lat: state.vel.lat * decay };
          state.idle = now;
          moving = true;
        } else if (mode === "full" && now - state.idle > 2600) {
          state.view = { lon: state.view.lon - 5 * dt, lat: state.view.lat };
          ambient = true;
        }
      }
      if (!visible || !state.scene || !(moving || state.dirty || state.drag || (ambient && tick % 2 === 0))) return;
      state.dirty = false;
      const scene = { ...state.scene, hover: state.hover };
      state.markers = draw(ctx, state.size.w, state.size.h, state.size.s, state.view, scene, now);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) state.dirty = true;
    });
    io.observe(el);
    resize();
    state.idle = performance.now();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [mode]);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const el = canvas.current!;
    const rect = el.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * el.width,
      y: ((e.clientY - rect.top) / rect.height) * el.height,
      R: Math.min(rect.width, rect.height) * SPHERE,
    };
  };

  const hit = (x: number, y: number) => {
    const state = live.current;
    let best: string | null = null;
    let dist = 18 * state.size.s;
    for (const m of state.markers) {
      const d = Math.min(Math.hypot(m.x - x, m.y - y), Math.hypot(m.tx - x, m.ty - y));
      if (d < dist) {
        dist = d;
        best = m.key;
      }
    }
    return best;
  };

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      tabIndex={0}
      className={cn("block aspect-square w-full cursor-grab touch-none select-none outline-none", className)}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const state = live.current;
        state.fly = null;
        state.vel = { lon: 0, lat: 0 };
        state.drag = { x: e.clientX, y: e.clientY, view: { ...state.view }, moved: 0, t: performance.now() };
        el.style.cursor = "grabbing";
      }}
      onPointerMove={(e) => {
        const state = live.current;
        const { x, y, R } = toCanvas(e);
        if (state.drag) {
          const dx = e.clientX - state.drag.x;
          const dy = e.clientY - state.drag.y;
          const prev = state.view;
          state.view = {
            lon: state.drag.view.lon - (dx / R) * (180 / Math.PI),
            lat: clamp(state.drag.view.lat + (dy / R) * (180 / Math.PI), -70, 70),
          };
          const now = performance.now();
          const dt = Math.max(0.008, (now - state.drag.t) / 1000);
          state.vel = { lon: (state.view.lon - prev.lon) / dt, lat: (state.view.lat - prev.lat) / dt };
          state.drag.t = now;
          state.drag.moved = Math.max(state.drag.moved, Math.hypot(dx, dy));
          state.dirty = true;
          return;
        }
        const key = hit(x, y);
        if (key !== state.hover) {
          state.hover = key;
          state.dirty = true;
          e.currentTarget.style.cursor = key ? "pointer" : "grab";
        }
      }}
      onPointerUp={(e) => {
        const state = live.current;
        const drag = state.drag;
        state.drag = null;
        state.idle = performance.now();
        e.currentTarget.style.cursor = state.hover ? "pointer" : "grab";
        if (drag && drag.moved < 4) {
          const { x, y } = toCanvas(e);
          const key = hit(x, y);
          state.vel = { lon: 0, lat: 0 };
          if (key) state.onActive?.(key);
        } else if (performance.now() - (drag?.t ?? 0) > 80) {
          state.vel = { lon: 0, lat: 0 };
        }
      }}
      onPointerLeave={() => {
        const state = live.current;
        if (state.hover) {
          state.hover = null;
          state.dirty = true;
        }
      }}
      onKeyDown={(e) => {
        const step = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, 15], ArrowDown: [0, -15] }[e.key];
        if (!step) return;
        e.preventDefault();
        const state = live.current;
        const from = { ...state.view };
        state.fly = { from, to: { lon: from.lon + step[0], lat: clamp(from.lat + step[1], -70, 70) }, start: performance.now(), dur: mode === "off" ? 1 : 380 };
      }}
    />
  );
}
