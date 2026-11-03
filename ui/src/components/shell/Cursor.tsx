import { useEffect, useMemo, useRef } from "react";
import { media } from "../../lib/api";
import type { Asset } from "../../lib/types";
import { BANDS, readLevels, useSystemAudio } from "../../player/levels";
import { useAssetMeta } from "../../desk/AssetLibrary";
import { usePrefs } from "../../store/prefs";
import { assetUrl, FX, useLook, type CursorTrail, type Fx } from "../../theme/look";
import { InkImage } from "../../theme/skins";
import { rgba, toRgb, type RGB } from "../visual/color";

const POINTER = "a,button,[role=button],[role=menuitem],[role=menuitemradio],[role=tab],[role=option],[role=switch],[role=checkbox],[role=radio],[role=slider],select,summary,label";
const TEXT = "input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]),textarea,[contenteditable=true]";
const MASK = { original: "original", ink: "dark", light: "light", silhouette: "solid" } as const;
const ON = ':root[data-cursor="image"]';

type Box = { w: number; h: number };

function contained(asset: Asset, size: number): Box {
  const { w, h } = asset;
  if (!w || !h || w === h) return { w: size, h: size };
  return w > h ? { w: size, h: Math.max(1, Math.round((h / w) * size)) } : { w: Math.max(1, Math.round((w / h) * size)), h: size };
}

function hot(box: Box, spot: Fx["cursorHot"]) {
  return spot === "center" ? { x: Math.floor(box.w / 2), y: Math.floor(box.h / 2) } : { x: 0, y: 0 };
}

const hex = (color: string) =>
  toRgb(color)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");

let imageSet: boolean | null = null;

function nativeCursor(asset: Asset, fx: Fx, ink: string) {
  const box = contained(asset, fx.cursorSize);
  const spot = hot(box, fx.cursorHot);
  const url = (s: number) => media(`/api/assets/${asset.id}/cursor?s=${s}&mode=${MASK[fx.cursorInk]}&color=${hex(ink)}`);
  imageSet ??= CSS.supports("cursor", 'image-set(url("a.png") 1x, url("b.png") 2x) 0 0, auto');
  const image = imageSet ? `image-set(url("${url(fx.cursorSize)}") 1x, url("${url(fx.cursorSize * 2)}") 2x)` : `url("${url(fx.cursorSize)}")`;
  return `${image} ${spot.x} ${spot.y}`;
}

function Picture({ asset, mode, box, ink }: { asset: Asset; mode: Fx["cursorInk"]; box: Box; ink: string }) {
  const size = box.w * 2 <= 160 && box.h * 2 <= 160 ? 160 : 320;
  if (mode === "original") return <img src={assetUrl(asset.id, size)} alt="" draggable={false} className="block h-full w-full object-contain" />;
  return <InkImage asset={asset.id} mode={mode} size={size} className="h-full w-full" style={{ color: ink }} />;
}

function SoftCursor({ fx, main, hover, ink, scale, still }: { fx: Fx; main: Asset; hover: Asset | null; ink: string; scale: number; still: boolean }) {
  useSystemAudio();
  const node = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  const box = contained(main, fx.cursorSize);
  const hoverBox = hover ? contained(hover, fx.cursorSize) : box;
  const opts = useRef({ smooth: false, react: false, spot: fx.cursorHot, box, hoverBox, hover: !!hover, scale });
  opts.current = { smooth: fx.cursorSmooth && !still, react: fx.cursorReact && !still, spot: fx.cursorHot, box, hoverBox, hover: !!hover, scale };

  useEffect(() => {
    const levels = new Float32Array(BANDS);
    let x = -500;
    let y = -500;
    let cx = x;
    let cy = y;
    let over = false;
    let text = false;
    let away = true;
    let down = false;
    let press = 1;
    let energy = 0;
    let shown = "";
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      x = e.clientX;
      y = e.clientY;
      if (away) {
        cx = x;
        cy = y;
        away = false;
      }
      const target = e.target instanceof Element ? e.target : null;
      over = !!target?.closest(POINTER);
      text = !!target?.closest(TEXT);
    };
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) away = true;
    };
    const pressDown = () => (down = true);
    const pressUp = () => (down = false);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const o = opts.current;
      const el = node.current;
      if (!el) return;
      const k = o.smooth ? 0.24 : 1;
      cx += (x - cx) * k;
      cy += (y - cy) * k;
      energy = o.react ? energy + (Math.min(1, readLevels(levels).rms) - energy) * 0.18 : 0;
      press += ((down ? 0.82 : 1) - press) * 0.35;
      const swap = over && o.hover;
      const b = swap ? o.hoverBox : o.box;
      const spot = hot(b, o.spot);
      const grow = press * (over && !o.hover ? 1.14 : 1) * (1 + energy * 0.32);
      const state = `${(cx / o.scale - spot.x).toFixed(1)},${(cy / o.scale - spot.y).toFixed(1)},${grow.toFixed(3)},${swap},${away || text}`;
      if (state === shown) return;
      shown = state;
      el.style.transform = `translate3d(${cx / o.scale - spot.x}px, ${cy / o.scale - spot.y}px, 0) scale(${grow})`;
      el.style.transformOrigin = `${spot.x}px ${spot.y}px`;
      el.style.width = `${b.w}px`;
      el.style.height = `${b.h}px`;
      el.style.opacity = away || text ? "0" : "1";
      if (first.current) first.current.style.display = swap ? "none" : "block";
      if (second.current) second.current.style.display = swap ? "block" : "none";
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", pressDown, { passive: true });
    window.addEventListener("pointerup", pressUp, { passive: true });
    document.addEventListener("mouseout", out);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", pressDown);
      window.removeEventListener("pointerup", pressUp);
      document.removeEventListener("mouseout", out);
    };
  }, []);

  return (
    <div ref={node} aria-hidden data-soft-cursor className="pointer-events-none fixed left-0 top-0 z-[2147483000] opacity-0" style={{ width: box.w, height: box.h }}>
      <div ref={first} className="h-full w-full">
        <Picture asset={main} mode={fx.cursorInk} box={box} ink={ink} />
      </div>
      {hover && (
        <div ref={second} className="hidden h-full w-full">
          <Picture asset={hover} mode={fx.cursorInk} box={hoverBox} ink={ink} />
        </div>
      )}
    </div>
  );
}

type Dot = { x: number; y: number; t: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; spin: number };

function Trail({ kind, color, scale }: { kind: Exclude<CursorTrail, "none">; color: RGB; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dots: Dot[] = [];
    const sparks: Spark[] = [];
    const rings: Dot[] = [];
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let last = performance.now();
    let lx = -1;
    let ly = -1;
    const keep = kind === "ink" ? 0.42 : 0.3;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
    };
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const time = now / 1000;
      while (dots.length && time - dots[0].t > keep) dots.shift();
      if (kind === "ink" && dots.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < dots.length; i++) {
          const life = 1 - (time - dots[i].t) / keep;
          ctx.strokeStyle = rgba(color, 0.55 * life);
          ctx.lineWidth = 0.6 + 5.4 * life * life;
          ctx.beginPath();
          ctx.moveTo(dots[i - 1].x, dots[i - 1].y);
          ctx.lineTo(dots[i].x, dots[i].y);
          ctx.stroke();
        }
      }
      if (kind === "comet") {
        for (const d of dots) {
          const life = 1 - (time - d.t) / keep;
          ctx.fillStyle = rgba(color, 0.5 * life);
          ctx.beginPath();
          ctx.arc(d.x, d.y, 0.8 + 4.2 * life, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt;
        if (s.life >= s.max) {
          sparks.splice(i, 1);
          continue;
        }
        s.vy += 160 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const life = 1 - s.life / s.max;
        const r = s.r * life;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.spin * s.life);
        ctx.fillStyle = rgba(color, 0.9 * life);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.quadraticCurveTo(0, 0, 0, r);
        ctx.quadraticCurveTo(0, 0, -r, 0);
        ctx.quadraticCurveTo(0, 0, 0, -r);
        ctx.fill();
        ctx.restore();
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const age = time - rings[i].t;
        if (age > 0.55) {
          rings.splice(i, 1);
          continue;
        }
        const k = age / 0.55;
        ctx.strokeStyle = rgba(color, 0.7 * (1 - k));
        ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(rings[i].x, rings[i].y, 4 + 30 * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (dots.length || sparks.length || rings.length) raf = requestAnimationFrame(frame);
      else running = false;
    };
    const wake = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const x = e.clientX / scale;
      const y = e.clientY / scale;
      if (kind === "ink" || kind === "comet") dots.push({ x, y, t: performance.now() / 1000 });
      if (kind === "sparkle") {
        const travel = lx < 0 ? 0 : Math.hypot(x - lx, y - ly);
        for (let n = Math.min(4, Math.floor(travel / 7)); n > 0; n--)
          sparks.push({ x, y, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 70, life: 0, max: 0.5 + Math.random() * 0.4, r: 2 + Math.random() * 3.5, spin: (Math.random() - 0.5) * 8 });
        if (sparks.length > 220) sparks.splice(0, sparks.length - 220);
      }
      lx = x;
      ly = y;
      if (kind !== "ripple") wake();
    };
    const click = (e: PointerEvent) => {
      if (kind !== "ripple") return;
      rings.push({ x: e.clientX / scale, y: e.clientY / scale, t: performance.now() / 1000 });
      wake();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", click, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", click);
    };
  }, [kind, color, scale]);
  return <canvas ref={ref} aria-hidden data-cursor-trail={kind} className="pointer-events-none fixed inset-0 z-[2147482999] h-full w-full" />;
}

export function CursorLayer() {
  const fx = { ...FX, ...(useLook((s) => s.look.fx) ?? {}) };
  const ink = useLook((s) => s.look.ink);
  const scale = useLook((s) => s.look.scale);
  const still = usePrefs((s) => s.motion) === "off";
  const picked = fx.cursor === "image";
  const main = useAssetMeta(picked ? fx.cursorAsset : null);
  const hoverMeta = useAssetMeta(picked ? fx.cursorHover : null);
  const hover = hoverMeta && !hoverMeta.video ? hoverMeta : null;
  const usable = picked && !!main && !main.video;
  const soft =
    usable && (fx.cursorSmooth || fx.cursorReact || fx.cursorSize > 32 || main.animated || main.mime === "image/svg+xml" || !!hover?.animated || hover?.mime === "image/svg+xml");
  const color = useMemo(() => toRgb(ink), [ink]);
  const css = usable && !soft ? [nativeCursor(main, fx, ink), hover ? nativeCursor(hover, fx, ink) : null] : null;

  useEffect(() => {
    const root = document.documentElement;
    let tag = document.getElementById("karasu-cursor");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "karasu-cursor";
      document.head.appendChild(tag);
    }
    if (soft) root.dataset.cursorSoft = "";
    else delete root.dataset.cursorSoft;
    const [base, over] = css ?? [null, null];
    const text = base
      ? `${ON} body, ${ON} button, ${ON} a, ${ON} [role=button] { cursor: ${base}, auto; }
${ON} :is(a, button, [role=button], [role=menuitem], select, summary, label) { cursor: ${over ?? base}, pointer; }
${ON} :is(${TEXT}) { cursor: text; }`
      : "";
    if (tag.textContent !== text) tag.textContent = text;
  }, [soft, css?.[0], css?.[1]]);

  useEffect(
    () => () => {
      delete document.documentElement.dataset.cursorSoft;
      document.getElementById("karasu-cursor")?.replaceChildren();
    },
    [],
  );

  return (
    <>
      {soft && main && <SoftCursor fx={fx} main={main} hover={hover} ink={ink} scale={scale} still={still} />}
      {fx.cursorTrail !== "none" && !still && <Trail kind={fx.cursorTrail} color={color} scale={scale} />}
    </>
  );
}
