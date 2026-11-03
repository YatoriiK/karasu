import { useEffect, useRef, useState } from "react";
import { Maximize2, RotateCcw } from "lucide-react";
import { useAssetMeta } from "../../desk/AssetLibrary";
import { assetUrl, useLook, type Wallpaper } from "../../theme/look";
import { useLoopingVideo } from "../../theme/skins";
import { Slider } from "../ui/controls";
import { useBox } from "./Wallpaper";
import { focus, placed } from "./wallpaperFit";

const MIN = 0.2;
const MAX = 4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function PreviewVideo({ src, style }: { src: string; style: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useLoopingVideo(ref);
  return <video ref={ref} src={src} muted loop playsInline disablePictureInPicture className="absolute max-w-none" style={style} />;
}

export function WallpaperFramer({ wp, onChange }: { wp: Wallpaper; onChange: (patch: Partial<Wallpaper>) => void }) {
  const meta = useAssetMeta(wp.asset);
  const scale = useLook((s) => s.look.scale);
  const frame = useRef<HTMLDivElement>(null);
  const size = useBox(frame);
  const [ratio, setRatio] = useState(() => window.innerWidth / Math.max(1, window.innerHeight));
  const latest = useRef(wp);
  latest.current = wp;
  const change = useRef(onChange);
  change.current = onChange;
  const pending = useRef<Partial<Wallpaper> | null>(null);
  const raf = useRef(0);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);

  const push = (patch: Partial<Wallpaper>) => {
    pending.current = { ...(pending.current ?? {}), ...patch };
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const next = pending.current;
      pending.current = null;
      if (next) change.current(next);
    });
  };

  useEffect(() => {
    const resize = () => setRatio(window.innerWidth / Math.max(1, window.innerHeight));
    window.addEventListener("resize", resize);
    const el = frame.current;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoom = pending.current?.zoom ?? latest.current.zoom ?? 1;
      push({ zoom: clamp(zoom * Math.exp(-e.deltaY * 0.0015), MIN, MAX) });
    };
    el?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("resize", resize);
      el?.removeEventListener("wheel", wheel);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  if (!wp.asset) return null;
  const zoom = wp.zoom ?? 1;
  const spot = meta?.w && meta.h && size.w ? placed(wp.fit, size.w, size.h, meta.w, meta.h, wp) : null;
  const url = assetUrl(wp.asset, meta?.video ? undefined : 640);
  const filter = [wp.mono ? "grayscale(1)" : "", wp.blur ? `blur(${(wp.blur * size.w) / Math.max(1, window.innerWidth)}px)` : ""].join(" ").trim() || undefined;

  return (
    <div data-wallpaper-framer>
      <div
        ref={frame}
        className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-md bg-[var(--paper)] shadow-[inset_0_0_0_1px_var(--line-strong)] active:cursor-grabbing"
        style={{ aspectRatio: ratio }}
        onPointerDown={(e) => {
          if (!spot) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const [fx, fy] = focus(latest.current);
          drag.current = { x: e.clientX, y: e.clientY, fx, fy };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !spot) return;
          const dx = (e.clientX - d.x) / scale;
          const dy = (e.clientY - d.y) / scale;
          const spanX = size.w - spot.w;
          const spanY = size.h - spot.h;
          const patch: Partial<Wallpaper> = {};
          if (Math.abs(spanX) > 1) patch.x = clamp(d.fx + (dx / spanX) * 100, 0, 100);
          if (Math.abs(spanY) > 1) patch.y = clamp(d.fy + (dy / spanY) * 100, 0, 100);
          push(patch);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {meta?.video && url ? (
          <PreviewVideo src={url} style={spot ? { width: spot.w, height: spot.h, left: spot.left, top: spot.top, filter } : { inset: 0, width: "100%", height: "100%", objectFit: "cover", filter }} />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: url ? `url("${url}")` : undefined,
              backgroundSize: spot ? `${spot.w}px ${spot.h}px` : wp.fit === "tile" ? "auto" : wp.fit,
              backgroundRepeat: wp.fit === "tile" ? "repeat" : "no-repeat",
              backgroundPosition: spot ? `${spot.left}px ${spot.top}px` : "center",
              filter,
            }}
          />
        )}
        <div className="pointer-events-none absolute inset-0" style={{ background: `color-mix(in srgb, var(--paper) ${Math.round(wp.dim * 100)}%, transparent)` }} />
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">{Math.round(zoom * 100)}%</span>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <span className="shrink-0 text-[12px] text-fg-2">Zoom</span>
        <Slider value={zoom} min={MIN} max={MAX} step={0.01} label="Wallpaper zoom" className="min-w-0 flex-1" onChange={(v) => onChange({ zoom: v })} />
        <button
          onClick={() => onChange({ fit: "contain", zoom: 1, x: undefined, y: undefined, position: "center" })}
          className="flex shrink-0 items-center gap-1 text-[12px] text-fg-2 hover:text-fg-0"
          title="Shrink the picture so all of it shows"
        >
          <Maximize2 size={12} /> fit all
        </button>
        <button
          onClick={() => onChange({ zoom: 1, x: undefined, y: undefined, position: "center" })}
          className="flex shrink-0 items-center gap-1 text-[12px] text-fg-2 hover:text-fg-0"
          title="Back to the normal size, centered"
        >
          <RotateCcw size={12} /> reset
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">Drag the picture to choose what shows, scroll on it to zoom. The box is the shape of your screen.</p>
    </div>
  );
}
