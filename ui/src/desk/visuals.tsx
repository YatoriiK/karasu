import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { api } from "../lib/api";
import { compact } from "../lib/format";
import type { Track } from "../lib/types";
import { BANDS, readLevels, useSystemAudio } from "../player/levels";
import { playbackNow } from "../hooks/usePlayback";
import { currentTrack, usePlayer } from "../store/player";
import { usePrefs } from "../store/prefs";
import { useUi } from "../store/ui";
import { useLook } from "../theme/look";
import { AlbumArt } from "../components/music/AlbumArt";
import { TrackContextMenu } from "../components/music/TrackMenu";
import { useTrackActions } from "../components/music/useTrackActions";
import { Globe } from "../components/globe/Globe";
import { toGlobePoints } from "../components/globe/points";
import { TasteMap } from "../components/charts/TasteMap";
import { lyricsQuery } from "../components/player/NowPlaying";
import { Record, type RecordKind } from "../components/visual/Record";
import { rgba, toRgb, type RGB } from "../components/visual/color";
import { Pulse } from "../components/visual/pulse";
import { makeScene, sceneBlur, type Painter } from "../components/visual/scenes";
import { useSceneColor } from "../components/shell/SceneLayer";
import { cn } from "../components/ui/cn";
import { Empty, prop, type WidgetProps } from "./widgets";

type Frame = { ctx: CanvasRenderingContext2D; w: number; h: number; dt: number; t: number; bands: Float32Array; rms: number; ink: RGB; dark: boolean };

function useCanvas(draw: (f: Frame) => void, audio: boolean) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paint = useRef(draw);
  paint.current = draw;
  const ink = useLook((s) => s.look.ink);
  const dark = useLook((s) => s.look.scheme) === "dark";
  const still = usePrefs((s) => s.motion) === "off";
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const color = toRgb(ink);
    const bands = new Float32Array(BANDS);
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let t = 0;
    let visible = true;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden || !w || !h) return;
      const dt = still ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const rms = audio ? readLevels(bands).rms : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint.current({ ctx, w, h, dt, t, bands, rms, ink: color, dark });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);
    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [ink, dark, still, audio]);
  return ref;
}

function band(arr: Float32Array, u: number) {
  const pos = Math.min(1, Math.max(0, u)) * (BANDS - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return arr[i] * (1 - f) + arr[Math.min(BANDS - 1, i + 1)] * f;
}

function average(arr: Float32Array, from: number, to: number) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += arr[i];
  return sum / Math.max(1, to - from);
}

export function GlobeWidget({ item }: WidgetProps) {
  const source = prop<string>(item, "source", "playing");
  const custom = prop<string>(item, "artist", "");
  const caption = prop(item, "caption", true);
  const track = usePlayer(currentTrack);
  const { data: stats } = useQuery({ queryKey: ["stats", "month"], queryFn: () => api.stats("month"), enabled: source === "top", staleTime: 600_000 });
  const pick =
    source === "custom"
      ? custom.trim()
        ? { artist: custom.trim() }
        : null
      : source === "top"
        ? stats?.top_artists[0]
          ? { artist: stats.top_artists[0].name }
          : null
        : track
          ? { track: track.id }
          : null;
  const { data } = useQuery({
    queryKey: ["listeners", pick],
    queryFn: () => api.listeners(pick!),
    enabled: !!pick,
    staleTime: 15 * 60_000,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 1500 : false),
  });
  const points = useMemo(() => toGlobePoints(data), [data]);
  const lead = points[0]?.key ?? null;
  const [focus, setFocus] = useState<{ key: string; at: number } | null>(null);
  useEffect(() => setFocus(lead ? { key: lead, at: Date.now() } : null), [lead]);
  const top = data?.cities[0];
  return (
    <div className="flex h-full flex-col">
      <div className="relative grid min-h-0 flex-1 place-items-center [container-type:size]">
        <div style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}>
          <Globe points={points} active={lead} focus={focus} label={data?.artist.name ? `Where ${data.artist.name} is played` : "Listener globe"} />
        </div>
      </div>
      {caption && (
        <div className="truncate text-center font-mono text-[0.82em] text-fg-2">
          {data?.status === "off"
            ? "turn on the listener map in Settings"
            : !pick
            ? "play something to see where it's heard"
            : data?.status === "ok" && top
              ? `${data.artist.name} · ${top.city} ${compact(top.listeners)}`
              : data?.status === "pending" || !data
                ? "reading Spotify…"
                : `${data.artist.name ?? "this artist"} · no cities yet`}
        </div>
      )}
    </div>
  );
}

export function RecordWidget({ item }: WidgetProps) {
  const kind = prop<RecordKind>(item, "kind", "vinyl");
  const rpm = Number(prop(item, "rpm", 33));
  const arm = prop(item, "tonearm", true);
  const caption = prop(item, "caption", true);
  const track = usePlayer(currentTrack);
  const playing = usePlayer((s) => s.playing);
  const set = useUi((s) => s.set);
  const square = kind !== "tape";
  return (
    <div className="flex h-full flex-col">
      <div className="relative grid min-h-0 flex-1 place-items-center [container-type:size]">
        <TrackContextMenu track={track}>
          <button
            onClick={() => track && set({ nowPlaying: true })}
            aria-label="Open Now Playing"
            style={square ? { width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" } : { width: "min(100cqw, 160cqh)" }}
          >
            <Record art={track?.art} seed={track?.id ?? "karasu"} spinning={playing && !!track} kind={kind} rpm={rpm} tonearm={arm} title={track?.title} className="h-full w-full" />
          </button>
        </TrackContextMenu>
      </div>
      {caption && (
        <div className="mt-[0.4em] truncate text-center text-[0.9em]">
          <span className="font-semibold text-fg-0">{track?.title ?? "Nothing playing"}</span>
          {track && <span className="text-fg-2"> · {track.artist.name}</span>}
        </div>
      )}
    </div>
  );
}

export function RingWidget({ item }: WidgetProps) {
  useSystemAudio();
  const bars = Number(prop(item, "bars", 72));
  const sensitivity = Number(prop(item, "sensitivity", 1));
  const showArt = prop(item, "art", true);
  const spin = prop(item, "spin", true);
  const track = usePlayer(currentTrack);
  const playing = usePlayer((s) => s.playing);
  const level = useRef(new Float32Array(256));
  const ref = useCanvas(({ ctx, w, h, dt, t, bands, rms, ink }) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const size = Math.min(w, h);
    const inner = size * (showArt ? 0.27 : 0.2);
    const span = size * 0.2;
    const n = Math.max(8, Math.min(240, Math.round(bars)));
    const half = Math.ceil(n / 2);
    const lv = level.current;
    const rot = spin ? t * 0.15 : 0;
    const e = Math.min(1, rms);
    const halo = ctx.createRadialGradient(cx, cy, inner * 0.92, cx, cy, inner + span * (0.5 + 0.5 * e));
    halo.addColorStop(0, rgba(ink, 0.06 + 0.2 * e));
    halo.addColorStop(1, rgba(ink, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, ((Math.PI * 2 * inner) / n) * 0.42);
    for (let i = 0; i < n; i++) {
      const k = i < half ? i : n - 1 - i;
      const v = Math.min(1, band(bands, 0.03 + (k / half) * 0.82) * sensitivity);
      lv[i] = v > lv[i] ? lv[i] + (v - lv[i]) * 0.6 : lv[i] + (v - lv[i]) * Math.min(1, dt * 5);
      const a = rot + (i / n) * Math.PI * 2 - Math.PI / 2;
      const len = 1.5 + lv[i] * span;
      ctx.strokeStyle = rgba(ink, 0.3 + 0.7 * lv[i]);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
      ctx.stroke();
    }
  }, true);
  return (
    <div className="relative h-full w-full [container-type:size]">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {showArt && (
        <TrackContextMenu track={track}>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: "min(50cqw, 50cqh)", height: "min(50cqw, 50cqh)" }}>
            <div className="h-full w-full" style={spin && playing ? { animation: "karasu-spin 14s linear infinite" } : undefined}>
              {track ? (
                <AlbumArt art={track.art} seed={track.id} size={260} className="h-full w-full" rounded="rounded-full" />
              ) : (
                <div className="seal grid h-full w-full place-items-center rounded-full bg-bg-3 text-[2.4em] text-fg-3">烏</div>
              )}
            </div>
          </div>
        </TrackContextMenu>
      )}
    </div>
  );
}

const VU = [
  [-20, 0],
  [-10, 0.24],
  [-7, 0.35],
  [-5, 0.45],
  [-3, 0.57],
  [-1, 0.71],
  [0, 0.78],
  [1, 0.85],
  [2, 0.92],
  [3, 1],
] as const;

export function MetersWidget({ item }: WidgetProps) {
  useSystemAudio();
  const count = Number(prop(item, "count", 2));
  const style = prop<string>(item, "style", "analog");
  const sensitivity = Number(prop(item, "sensitivity", 1));
  const state = useRef({ pos: [0, 0], vel: [0, 0], peak: [0, 0], hold: [0, 0], mean: [0, 0], dev: [0, 0] });
  const ref = useCanvas(({ ctx, w, h, dt, bands, rms, ink }) => {
    ctx.clearRect(0, 0, w, h);
    const s = state.current;
    const meters = count === 1 ? 1 : 2;
    const lows = average(bands, 0, 22);
    const highs = average(bands, 22, 58);
    const loud = Math.min(1, rms);
    const signal = meters === 1 ? [0.3 * (lows + highs) + 0.4 * loud] : [0.6 * lows + 0.4 * loud, 0.6 * highs + 0.4 * loud];
    const rest = Math.max(0.3, Math.min(0.9, 0.58 + (sensitivity - 1) * 0.16));
    const swing = 0.11 * sensitivity;
    const k = 1 - Math.exp(-dt / 2.5);
    for (let m = 0; m < meters; m++) {
      const x = signal[m];
      let target = 0;
      if (x > 0.001) {
        if (!s.mean[m]) {
          s.mean[m] = x;
          s.dev[m] = 0.04;
        }
        s.mean[m] += (x - s.mean[m]) * k;
        s.dev[m] += (Math.abs(x - s.mean[m]) - s.dev[m]) * k;
        target = Math.max(0, Math.min(1.08, rest + ((x - s.mean[m]) / Math.max(0.02, s.dev[m])) * swing));
      }
      const acc = (target - s.pos[m]) * 160 - s.vel[m] * 22;
      s.vel[m] += acc * dt;
      s.pos[m] = Math.max(0, Math.min(1.1, s.pos[m] + s.vel[m] * dt));
      if (s.pos[m] > s.peak[m]) {
        s.peak[m] = s.pos[m];
        s.hold[m] = 1.2;
      } else {
        s.hold[m] -= dt;
        if (s.hold[m] <= 0) s.peak[m] = Math.max(s.pos[m], s.peak[m] - dt * 0.6);
      }
    }
    const side = w >= h;
    for (let m = 0; m < meters; m++) {
      const cw = side ? w / meters : w;
      const ch = side ? h : h / meters;
      const x0 = side ? m * cw : 0;
      const y0 = side ? 0 : m * ch;
      const pad = Math.min(cw, ch) * 0.06;
      if (style === "led") {
        const n = 24;
        const segW = (cw - pad * 2) / n;
        const segH = Math.min(ch - pad * 2, ch * 0.42);
        const top = y0 + (ch - segH) / 2;
        for (let i = 0; i < n; i++) {
          const lit = (i + 1) / n <= Math.min(1, s.pos[m]);
          const peak = Math.abs((i + 1) / n - Math.min(1, s.peak[m])) < 0.5 / n;
          ctx.fillStyle = rgba(ink, lit ? (i > n * 0.8 ? 1 : 0.75) : peak ? 0.9 : 0.08);
          ctx.fillRect(x0 + pad + i * segW + 1, top, segW - 2, segH);
        }
        continue;
      }
      ctx.strokeStyle = rgba(ink, 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x0 + pad, y0 + pad, cw - pad * 2, ch - pad * 2, Math.min(cw, ch) * 0.05);
      ctx.stroke();
      const cx = x0 + cw / 2;
      const R = Math.min((cw - pad * 2) * 0.62, (ch - pad * 2) * 1.05);
      const cy = y0 + pad + 0.18 * (ch - pad * 2) + R;
      const angle = (f: number) => -Math.PI / 2 + (-50 + f * 100) * (Math.PI / 180);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + pad, y0 + pad, cw - pad * 2, ch - pad * 2);
      ctx.clip();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(ink, 0.55);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.82, angle(0), angle(0.78));
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(ink, 0.85);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.82, angle(0.78), angle(1));
      ctx.stroke();
      ctx.font = `${Math.max(8, R * 0.075)}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-mono-stack") || "monospace"}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const [db, f] of VU) {
        const a = angle(f);
        ctx.strokeStyle = rgba(ink, f >= 0.78 ? 0.9 : 0.55);
        ctx.lineWidth = f >= 0.78 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82);
        ctx.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
        ctx.stroke();
        if ([-20, -10, -5, -3, 0, 3].includes(db)) {
          ctx.fillStyle = rgba(ink, 0.7);
          ctx.fillText(db > 0 ? `+${db}` : String(db), cx + Math.cos(a) * R * 0.99, cy + Math.sin(a) * R * 0.99);
        }
      }
      ctx.fillStyle = rgba(ink, 0.45);
      ctx.fillText(meters === 2 ? (m === 0 ? "VU · L" : "VU · R") : "VU", cx, cy - R * 0.38);
      const a = angle(Math.min(1.06, s.pos[m]));
      ctx.strokeStyle = rgba(ink, 0.95);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12);
      ctx.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
      ctx.stroke();
      ctx.fillStyle = rgba(ink, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, R * 0.045), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }, true);
  return <canvas ref={ref} className="h-full w-full" />;
}

export function LyricsWidget({ item }: WidgetProps) {
  const track = usePlayer(currentTrack);
  const lines = Math.max(3, Math.min(11, Number(prop(item, "lines", 5))));
  const align = prop<string>(item, "align", "center");
  const { data } = useQuery({ ...lyricsQuery(track?.id ?? "none"), enabled: !!track });
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNow(playbackNow()), 250);
    return () => window.clearInterval(t);
  }, []);
  if (!track) return <Empty>Play something to see its lyrics</Empty>;
  if (!data) return <Empty>Looking for lyrics…</Empty>;
  if (data.instrumental) return <Empty>Instrumental</Empty>;
  if (!data.synced?.length) {
    if (!data.plain) return <Empty>{data.status === "busy" ? "The lyrics service is busy" : "No lyrics found"}</Empty>;
    return <div className="scroll-area h-full whitespace-pre-line text-[0.95em] leading-relaxed text-fg-1">{data.plain}</div>;
  }
  const synced = data.synced;
  let index = 0;
  for (let i = 0; i < synced.length; i++) if (synced[i].t <= now + 0.2) index = i;
  const half = Math.floor(lines / 2);
  return (
    <div className={cn("relative h-full overflow-hidden [container-type:size]", align === "left" ? "text-left" : "text-center")}>
      <div
        className="absolute inset-x-0 top-1/2 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
        style={{ transform: `translateY(calc(${-index - 0.5} * 1.7em))`, fontSize: `min(${100 / (lines * 1.7)}cqh, 7cqw)` }}
      >
        {synced.map((line, i) => {
          const d = Math.abs(i - index);
          return (
            <div
              key={i}
              className={cn("truncate font-display leading-[1.7em] transition-[opacity,color] duration-500", i === index ? "ink-glow text-fg-0" : "text-fg-2")}
              style={{ opacity: d > half ? 0 : i === index ? 1 : 0.55 - d * 0.1 }}
            >
              {line.text || "♪"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InkFlowWidget({ item }: WidgetProps) {
  useSystemAudio();
  const count = Math.max(50, Math.min(4000, Number(prop(item, "particles", 900))));
  const speed = Number(prop(item, "speed", 1));
  const trail = Number(prop(item, "trail", 0.06));
  const react = prop(item, "react", true);
  const parts = useRef<Float32Array | null>(null);
  const ref = useCanvas(({ ctx, w, h, dt, t, bands, rms, ink }) => {
    let p = parts.current;
    if (!p || p.length !== count * 2) {
      p = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        p[i * 2] = Math.random() * w;
        p[i * 2 + 1] = Math.random() * h;
      }
      parts.current = p;
    }
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${trail})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    const energy = react ? Math.min(1, rms * 1.4) : 0;
    const bass = react ? average(bands, 0, 8) : 0;
    const v = 38 * speed * (1 + energy * 2.2);
    const scale = 3.2 / Math.max(w, h);
    ctx.strokeStyle = rgba(ink, 0.16 + energy * 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = p[i * 2];
      const y = p[i * 2 + 1];
      const a = (Math.sin(x * scale + t * 0.25) + Math.cos(y * scale * 1.3 - t * 0.18) + Math.sin((x + y) * scale * 0.5 + bass * 3)) * Math.PI;
      const nx = x + Math.cos(a) * v * dt;
      const ny = y + Math.sin(a) * v * dt;
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      if (nx < 0 || nx > w || ny < 0 || ny > h || Math.random() < 0.003) {
        p[i * 2] = Math.random() * w;
        p[i * 2 + 1] = Math.random() * h;
      } else {
        p[i * 2] = nx;
        p[i * 2 + 1] = ny;
      }
    }
    ctx.stroke();
  }, true);
  return <canvas ref={ref} className="h-full w-full" />;
}

export function SceneWidget({ item }: WidgetProps) {
  useSystemAudio();
  const kind = prop<string>(item, "scene", "ripples");
  const sense = Number(prop(item, "sensitivity", 1));
  const color = useSceneColor(prop<string>(item, "color", "ink"));
  const scene = useRef<{ kind: string; paint: Painter; pulse: Pulse } | null>(null);
  const ref = useCanvas(({ ctx, w, h, dt, t, bands, rms, dark }) => {
    if (scene.current?.kind !== kind) scene.current = { kind, paint: makeScene(kind), pulse: new Pulse() };
    const s = scene.current;
    s.pulse.sense = sense;
    s.pulse.update(bands, rms, dt);
    s.paint({ ctx, w, h, dt, t, bands, pulse: s.pulse, color, dark });
  }, true);
  return <canvas ref={ref} data-scene={kind} className="h-full w-full" style={{ filter: sceneBlur(kind) }} />;
}

export function OrbWidget({ item }: WidgetProps) {
  useSystemAudio();
  const source = prop<string>(item, "color", "art");
  const pulse = Number(prop(item, "pulse", 1));
  const track = usePlayer(currentTrack);
  const ink = useLook((s) => s.look.ink);
  const accent = track?.art?.palette?.accent;
  const color = useRef<RGB>([236, 235, 230]);
  useEffect(() => {
    const css = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    color.current = toRgb(source === "art" && accent ? accent : source === "accent" && css ? css : ink);
  }, [source, accent, ink]);
  const energy = useRef(0);
  const ref = useCanvas(({ ctx, w, h, dt, t, rms, dark }) => {
    energy.current += (Math.min(1, rms * 1.3 * pulse) - energy.current) * Math.min(1, dt * 8);
    const e = energy.current;
    const c = color.current;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * (0.22 + e * 0.06);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, Math.min(R * 2, Math.min(w, h) * 0.5));
    halo.addColorStop(0, rgba(c, 0.32 + e * 0.3));
    halo.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (let k = 0; k < 4; k++) {
      const a = t * (0.3 + k * 0.13) + k * 1.7;
      const bx = cx + Math.cos(a) * R * 0.32;
      const by = cy + Math.sin(a * 1.3) * R * 0.28;
      const blob = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.95);
      blob.addColorStop(0, rgba(c, 0.42 + e * 0.2));
      blob.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(bx, by, R * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    const core = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, 0, cx, cy, R);
    core.addColorStop(0, `rgba(255,255,255,${dark ? 0.35 + e * 0.3 : 0.5})`);
    core.addColorStop(0.5, rgba(c, 0.55));
    core.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }, true);
  return <canvas ref={ref} className="h-full w-full" />;
}

export function CoverWallWidget({ item }: WidgetProps) {
  const source = prop<string>(item, "source", "saved");
  const columns = Math.max(2, Math.min(12, Number(prop(item, "columns", 5))));
  const every = Math.max(1, Number(prop(item, "interval", 5)));
  const mono = prop(item, "grayscale", false);
  const gap = Number(prop(item, "gap", 4));
  const actions = useTrackActions();
  const { data } = useQuery({ queryKey: ["library", source, 0, 80], queryFn: () => api.library(source, 0, 80), staleTime: 300_000 });
  const pool = useMemo(() => {
    const seen = new Set<string>();
    return (data?.items ?? []).filter((t) => t.art && !seen.has(t.art.ref) && seen.add(t.art.ref));
  }, [data]);
  const box = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(3);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const cell = (el.clientWidth - gap * (columns - 1)) / columns;
      setRows(Math.max(1, Math.floor((el.clientHeight + gap) / (cell + gap))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns, gap]);
  const cells = columns * rows;
  const [slots, setSlots] = useState<number[]>([]);
  useEffect(() => {
    if (pool.length) setSlots(Array.from({ length: cells }, (_, i) => i % pool.length));
  }, [pool, cells]);
  useEffect(() => {
    if (pool.length <= cells) return;
    const t = window.setInterval(() => {
      setSlots((current) => {
        const shown = new Set(current);
        const free = pool.map((_, i) => i).filter((i) => !shown.has(i));
        if (!free.length) return current;
        const next = [...current];
        next[Math.floor(Math.random() * next.length)] = free[Math.floor(Math.random() * free.length)];
        return next;
      });
    }, every * 1000);
    return () => window.clearInterval(t);
  }, [pool, cells, every]);
  if (data && !pool.length) return <Empty>No covers here yet</Empty>;
  const tracks: Track[] = slots.map((i) => pool[i]).filter(Boolean);
  return (
    <div ref={box} className="h-full w-full overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}>
        {tracks.map((t, i) => (
          <TrackContextMenu key={i} track={t}>
            <button onClick={() => actions.play(t, tracks)} className={cn("aspect-square transition-[filter] duration-500 hover:grayscale-0", mono && "grayscale")} aria-label={`Play ${t.title}`}>
              <AlbumArt art={t.art} seed={t.id} size={160} className="h-full w-full" rounded="rounded-sm" />
            </button>
          </TrackContextMenu>
        ))}
      </div>
    </div>
  );
}

export function HeatmapWidget({ item }: WidgetProps) {
  const weeks = Math.max(4, Math.min(53, Number(prop(item, "weeks", 26))));
  const labels = prop(item, "labels", true);
  const { data } = useQuery({ queryKey: ["stats", "year"], queryFn: () => api.stats("year"), staleTime: 600_000 });
  if (!data) return <Empty>Counting your plays…</Empty>;
  const byDay = new Map(data.series.map((s) => [s.date, s.plays]));
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const days: { date: string; plays: number; col: number; row: number }[] = [];
  const cursor = new Date(start);
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      if (cursor > end) break;
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      days.push({ date: key, plays: byDay.get(key) ?? 0, col, row });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const max = Math.max(1, ...days.map((d) => d.plays));
  const total = days.reduce((sum, d) => sum + d.plays, 0);
  const shade = [0.07, 0.25, 0.45, 0.7, 0.95];
  return (
    <div className="flex h-full flex-col gap-[0.4em]">
      {labels && (
        <div className="flex items-baseline justify-between gap-2 font-mono text-[0.78em] text-fg-2">
          <span>
            {total.toLocaleString()} plays · {weeks} weeks
          </span>
          <span className="flex items-center gap-[2px]">
            less
            {shade.map((a) => (
              <i key={a} className="inline-block h-[0.7em] w-[0.7em] rounded-[2px]" style={{ background: `color-mix(in srgb, var(--ink) ${a * 100}%, transparent)` }} />
            ))}
            more
          </span>
        </div>
      )}
      <svg viewBox={`0 0 ${weeks * 12} ${7 * 12}`} className="min-h-0 w-full flex-1" preserveAspectRatio="xMidYMid meet">
        {days.map((d) => {
          const level = d.plays === 0 ? 0 : Math.min(4, Math.ceil((d.plays / max) * 4));
          return (
            <rect key={d.date} x={d.col * 12 + 1} y={d.row * 12 + 1} width={10} height={10} rx={2} fill="var(--ink)" fillOpacity={shade[level]}>
              <title>
                {d.date}: {d.plays} plays
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

export function TasteMapWidget() {
  const { data } = useQuery({ queryKey: ["taste"], queryFn: api.taste, staleTime: 600_000 });
  if (!data) return <Empty>Mapping your taste…</Empty>;
  if (data.empty) return <Empty>Your taste map appears once your library is analysed</Empty>;
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden">
      <div className="w-full">
        <TasteMap map={data.map} />
      </div>
    </div>
  );
}

export function TickerWidget({ item }: WidgetProps) {
  const source = prop<string>(item, "source", "playing");
  const custom = prop<string>(item, "text", "烏 karasu · dig deeper");
  const speed = Math.max(10, Number(prop(item, "speed", 70)));
  const style = prop<string>(item, "style", "led");
  const track = usePlayer(currentTrack);
  const text = source === "custom" ? custom : track ? `${track.title} — ${track.artist.name}` : "nothing playing";
  const box = useRef<HTMLDivElement>(null);
  const span = useRef<HTMLSpanElement>(null);
  const [run, setRun] = useState({ from: 0, to: 0, seconds: 10 });
  useLayoutEffect(() => {
    const measure = () => {
      const width = box.current?.clientWidth ?? 0;
      const textWidth = span.current?.scrollWidth ?? 0;
      setRun({ from: width, to: -textWidth, seconds: Math.max(3, (width + textWidth) / speed) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [text, speed, style]);
  return (
    <div ref={box} className="relative flex h-full items-center overflow-hidden whitespace-nowrap [container-type:size]">
      <span
        ref={span}
        key={`${text}-${run.seconds}`}
        className={cn("inline-block text-fg-0 will-change-transform", style === "led" ? "led-dots" : "font-display")}
        style={{
          fontFamily: style === "led" ? "'DotGothic16', monospace" : undefined,
          fontSize: "62cqh",
          lineHeight: 1,
          textShadow: style === "led" ? "0 0 calc(14px * var(--glow)) color-mix(in srgb, var(--ink) 70%, transparent)" : undefined,
          ["--from" as string]: `${run.from}px`,
          ["--to" as string]: `${run.to}px`,
          animation: `karasu-marquee ${run.seconds}s linear infinite`,
        }}
      >
        {text}
      </span>
    </div>
  );
}

function chime() {
  try {
    const ac = new AudioContext();
    [880, 660].forEach((hz, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.28);
      gain.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + i * 0.28 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.28 + 0.26);
      osc.connect(gain).connect(ac.destination);
      osc.start(ac.currentTime + i * 0.28);
      osc.stop(ac.currentTime + i * 0.28 + 0.3);
    });
    window.setTimeout(() => ac.close(), 1200);
  } catch {
    /* no audio device */
  }
}

export function FocusWidget({ item }: WidgetProps) {
  const work = Math.max(1, Number(prop(item, "work", 25)));
  const rest = Math.max(1, Number(prop(item, "rest", 5)));
  const pauseMusic = prop(item, "pause", false);
  const sound = prop(item, "chime", true);
  const [phase, setPhase] = useState<"work" | "rest">("work");
  const [left, setLeft] = useState(work * 60);
  const [running, setRunning] = useState(false);
  const total = (phase === "work" ? work : rest) * 60;
  useEffect(() => {
    if (!running) setLeft((phase === "work" ? work : rest) * 60);
  }, [work, rest]);
  useEffect(() => {
    if (!running) return;
    const end = Date.now() + left * 1000;
    const t = window.setInterval(() => {
      const remain = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(remain);
      if (remain > 0) return;
      window.clearInterval(t);
      if (sound) chime();
      const next = phase === "work" ? "rest" : "work";
      if (next === "rest" && pauseMusic && usePlayer.getState().playing) usePlayer.getState().toggle();
      setPhase(next);
      setLeft((next === "work" ? work : rest) * 60);
    }, 250);
    return () => window.clearInterval(t);
  }, [running, phase]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const progress = 1 - left / total;
  return (
    <div className="relative grid h-full place-items-center [container-type:size]">
      <svg viewBox="0 0 100 100" className="absolute" style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}>
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${progress * 276.5} 276.5`}
          transform="rotate(-90 50 50)"
          className="transition-[stroke-dasharray] duration-300"
        />
      </svg>
      <div className="relative flex flex-col items-center">
        <div className="font-mono text-[0.75em] uppercase tracking-[0.2em] text-fg-3">{phase === "work" ? "集中 focus" : "休憩 break"}</div>
        <div className="ink-glow font-display leading-none text-fg-0 tabular-nums" style={{ fontSize: "min(22cqh, 20cqw)" }}>
          {mm}:{ss}
        </div>
        <div className="mt-[0.5em] flex gap-[0.4em]">
          <button aria-label={running ? "Pause timer" : "Start timer"} onClick={() => setRunning(!running)} className="grid h-[2.2em] w-[2.2em] place-items-center rounded-pill bg-fg-0 text-bg-0">
            {running ? <Pause size={14} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />}
          </button>
          <button
            aria-label="Reset timer"
            onClick={() => {
              setRunning(false);
              setPhase("work");
              setLeft(work * 60);
            }}
            className="grid h-[2.2em] w-[2.2em] place-items-center rounded-pill text-fg-2 hairline hover:text-fg-0"
          >
            <RotateCcw size={14} />
          </button>
          <button
            aria-label="Skip to next"
            onClick={() => {
              const next = phase === "work" ? "rest" : "work";
              setPhase(next);
              setLeft((next === "work" ? work : rest) * 60);
            }}
            className="grid h-[2.2em] w-[2.2em] place-items-center rounded-pill text-fg-2 hairline hover:text-fg-0"
          >
            <SkipForward size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
