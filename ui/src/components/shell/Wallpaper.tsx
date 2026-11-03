import { useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { BANDS, readLevels, useSystemAudio } from "../../player/levels";
import { useAssetMeta } from "../../desk/AssetLibrary";
import { useActiveLayout } from "../../desk/store";
import { usePrefs } from "../../store/prefs";
import { assetUrl, FX, useLook } from "../../theme/look";
import { useLoopingVideo } from "../../theme/skins";
import { focus, placed } from "./wallpaperFit";

export function useWallpaper() {
  const layout = useActiveLayout();
  const look = useLook((s) => s.look.wallpaper);
  return layout?.data.wallpaper ?? look;
}

function useSlideshow(minutes: number, current: string | null) {
  const { data } = useQuery({ queryKey: ["assets"], queryFn: api.assets, enabled: minutes > 0, staleTime: 60_000 });
  const pool = (data ?? []).filter((a) => (a.mime.startsWith("image/") || a.video) && (a.w ?? 0) >= 900).map((a) => a.id);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (minutes <= 0 || pool.length < 2) return;
    const t = window.setInterval(() => setIndex((i) => i + 1), minutes * 60_000);
    return () => window.clearInterval(t);
  }, [minutes, pool.length]);
  if (minutes <= 0 || pool.length < 2) return current;
  const start = Math.max(0, current ? pool.indexOf(current) : 0);
  return pool[(start + index) % pool.length];
}

function Pulse({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  useSystemAudio();
  useEffect(() => {
    const levels = new Float32Array(BANDS);
    let energy = 0;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { rms } = readLevels(levels);
      energy += (Math.min(1, rms * 1.3) - energy) * 0.12;
      if (target.current) target.current.style.transform = `scale(${1.04 + energy * 0.045})`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return null;
}

export function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

type Spot = { w: number; h: number; left: number; top: number };

function LoopVideo({ src, spot, fit, at }: { src: string; spot: Spot | null; fit: string; at: [number, number] }) {
  const ref = useRef<HTMLVideoElement>(null);
  useLoopingVideo(ref);
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      disablePictureInPicture
      className={spot ? "absolute max-w-none" : "h-full w-full"}
      style={spot ? { width: spot.w, height: spot.h, left: spot.left, top: spot.top } : { objectFit: fit === "contain" ? "contain" : "cover", objectPosition: `${at[0]}% ${at[1]}%` }}
    />
  );
}

const BLEED = 80;

export function Wallpaper() {
  const wp = useWallpaper();
  const fx = { ...FX, ...(useLook((s) => s.look.fx) ?? {}) };
  const still = usePrefs((s) => s.motion) === "off";
  const asset = useSlideshow(fx.slideshow, wp.asset);
  const meta = useAssetMeta(asset);
  const video = meta?.video ?? false;
  const url = meta === undefined ? undefined : assetUrl(asset);
  const root = useRef<HTMLDivElement>(null);
  const box = useBox(root);
  const at = focus(wp);
  const fitted = meta?.w && meta.h && box.w ? placed(wp.fit, box.w, box.h, meta.w, meta.h, wp) : null;
  const spot = fitted && { ...fitted, left: fitted.left + BLEED / 2, top: fitted.top + BLEED / 2 };
  const layer = useRef<HTMLDivElement>(null);
  const mode = still ? "none" : fx.wallMotion;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (mode !== "parallax") return;
    const move = (e: PointerEvent) => setTilt({ x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 });
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [mode]);

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden bg-paper" aria-hidden>
      <div
        ref={layer}
        className="absolute inset-0"
        style={
          mode === "drift"
            ? { animation: "karasu-drift 48s ease-in-out infinite" }
            : mode === "parallax"
              ? { transform: `scale(1.06) translate(${-tilt.x * 2.2}%, ${-tilt.y * 1.6}%)`, transition: "transform 900ms cubic-bezier(.16,1,.3,1)" }
              : undefined
        }
      >
        <AnimatePresence initial={false}>
          {url && (
            <motion.div
              key={url}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
              className="absolute -inset-10 transition-[filter] duration-500"
              style={{
                ...(video
                  ? {}
                  : {
                      backgroundImage: `url("${url}")`,
                      backgroundSize: spot ? `${spot.w}px ${spot.h}px` : wp.fit === "tile" ? "auto" : wp.fit,
                      backgroundRepeat: wp.fit === "tile" ? "repeat" : "no-repeat",
                      backgroundPosition: spot ? `${spot.left}px ${spot.top}px` : `${at[0]}% ${at[1]}%`,
                    }),
                filter: [wp.mono ? "grayscale(1)" : "", wp.blur ? `blur(${wp.blur}px)` : ""].join(" ").trim() || undefined,
              }}
            >
              {video && <LoopVideo src={url} spot={spot} fit={wp.fit} at={at} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {mode === "pulse" && <Pulse target={layer} />}
      <div className="absolute inset-0" style={{ background: `color-mix(in srgb, var(--paper) ${Math.round(wp.dim * 100)}%, transparent)` }} />
    </div>
  );
}
