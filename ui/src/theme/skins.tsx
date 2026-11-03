import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { media } from "../lib/api";
import { useAssetMeta } from "../desk/AssetLibrary";
import { usePrefs } from "../store/prefs";
import { toRgb } from "../components/visual/color";
import { assetUrl, useLook, type SkinEntry, type SkinMode } from "./look";

export type InkMode = SkinMode;
export type { SkinEntry };

export const INK_MODES: { value: InkMode; label: string; hint: string }[] = [
  { value: "ink", label: "Ink", hint: "Dark strokes become ink in the look's color — great for black-on-white art" },
  { value: "light", label: "Light ink", hint: "Light parts become ink — for white art on black" },
  { value: "silhouette", label: "Silhouette", hint: "A solid shape in the ink color" },
  { value: "original", label: "Original", hint: "Show the picture exactly as it is" },
];

const MASK: Record<Exclude<InkMode, "original">, string> = { ink: "dark", light: "light", silhouette: "solid" };

export function maskUrl(asset: string, mode: Exclude<InkMode, "original">, size: number) {
  return media(`/api/assets/${asset}/mask?mode=${MASK[mode]}&s=${size}`);
}

export function useLoopingVideo(ref: RefObject<HTMLVideoElement | null>) {
  const still = usePrefs((s) => s.motion) === "off";
  useEffect(() => {
    const sync = () => {
      const video = ref.current;
      if (!video) return;
      if (still || document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [ref, still]);
}

function InkVideo({ asset, mode, fit, grayscale, className, style }: { asset: string; mode: InkMode; fit: "contain" | "cover"; grayscale?: boolean; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useLoopingVideo(ref);
  const filter = mode === "original" ? (grayscale ? "grayscale(1)" : undefined) : `url(#karasu-video-${mode})`;
  return <video ref={ref} src={assetUrl(asset)} muted loop playsInline disablePictureInPicture className={className} style={{ objectFit: fit, filter, ...style }} />;
}

export function InkFilters() {
  const ink = useLook((s) => s.look.ink);
  const [r, g, b] = toRgb(ink).map((v) => (v / 255).toFixed(4));
  const rgb = `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b}`;
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}>
      <defs>
        <filter id="karasu-crisp" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncA type="linear" slope="1.35" intercept="-0.08" />
          </feComponentTransfer>
        </filter>
        <filter id="karasu-solid" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncA type="discrete" tableValues="0 0 1 1 1" />
          </feComponentTransfer>
        </filter>
        <filter id="karasu-video-ink" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`${rgb} -0.2126 -0.7152 -0.0722 0 1`} />
          <feComponentTransfer>
            <feFuncA type="linear" slope="1.3" intercept="-0.1" />
          </feComponentTransfer>
        </filter>
        <filter id="karasu-video-light" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`${rgb} 0.2126 0.7152 0.0722 0 0`} />
          <feComponentTransfer>
            <feFuncA type="linear" slope="1.3" intercept="-0.1" />
          </feComponentTransfer>
        </filter>
        <filter id="karasu-video-silhouette" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`${rgb} -0.2126 -0.7152 -0.0722 0 1`} />
          <feComponentTransfer>
            <feFuncA type="discrete" tableValues="0 0 1 1 1" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export function InkImage({
  asset,
  mode,
  size,
  fit = "contain",
  grayscale,
  className,
  style,
}: {
  asset: string;
  mode: InkMode;
  size: number;
  fit?: "contain" | "cover";
  grayscale?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const meta = useAssetMeta(asset);
  if (meta === undefined) return <span aria-hidden className={className} style={{ display: "block", ...style }} />;
  if (meta?.video) return <InkVideo asset={asset} mode={mode} fit={fit} grayscale={grayscale} className={className} style={style} />;
  if (mode !== "original" && meta?.animated) {
    const src = `url("${assetUrl(asset)}")`;
    const layers: CSSProperties =
      mode === "light" ? { maskImage: src, maskMode: "luminance" } : { maskImage: `${src}, ${src}`, maskMode: "alpha, luminance", maskComposite: "subtract" };
    return (
      <span aria-hidden className={className} style={{ display: "block", filter: `url(#${mode === "silhouette" ? "karasu-solid" : "karasu-crisp"})`, ...style }}>
        <span style={{ display: "block", width: "100%", height: "100%", backgroundColor: "currentColor", maskSize: fit, maskRepeat: "no-repeat", maskPosition: "center", ...layers }} />
      </span>
    );
  }
  if (mode === "original")
    return (
      <img
        src={assetUrl(asset, size)}
        alt=""
        draggable={false}
        className={className}
        style={{ objectFit: fit, filter: grayscale ? "grayscale(1)" : undefined, ...style }}
      />
    );
  const url = `url("${maskUrl(asset, mode === "ink" || mode === "light" || mode === "silhouette" ? mode : "ink", size)}")`;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "block",
        backgroundColor: "currentColor",
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: fit,
        maskSize: fit,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}

export const SKIN_SLOTS: { id: string; label: string; group: string }[] = [
  { id: "nav.desk", label: "Desk", group: "Dock" },
  { id: "nav.feed", label: "Feed", group: "Dock" },
  { id: "nav.discover", label: "Discover", group: "Dock" },
  { id: "nav.explore", label: "Explore", group: "Dock" },
  { id: "nav.library", label: "Library", group: "Dock" },
  { id: "nav.playlists", label: "Playlists", group: "Dock" },
  { id: "nav.stats", label: "Statistics", group: "Dock" },
  { id: "nav.profile", label: "Profile", group: "Dock" },
  { id: "nav.history", label: "History", group: "Dock" },
  { id: "nav.settings", label: "Settings", group: "Dock" },
  { id: "player.play", label: "Play", group: "Player" },
  { id: "player.pause", label: "Pause", group: "Player" },
  { id: "player.prev", label: "Previous", group: "Player" },
  { id: "player.next", label: "Next", group: "Player" },
  { id: "player.shuffle", label: "Shuffle", group: "Player" },
  { id: "player.repeat", label: "Repeat", group: "Player" },
  { id: "player.like", label: "Like", group: "Player" },
  { id: "bar.logo", label: "Logo", group: "Top bar" },
  { id: "bar.search", label: "Search", group: "Top bar" },
  { id: "bar.edit", label: "Edit desk", group: "Top bar" },
];

type SkinView = {
  skins: Record<string, SkinEntry>;
  setSkin: (slot: string, asset: string | null) => void;
  setMode: (slot: string, mode: InkMode) => void;
  reset: () => void;
};

const NO_SKINS: Record<string, SkinEntry> = {};

const skinActions = {
  setSkin: (slot: string, asset: string | null) => {
    const skins = { ...(useLook.getState().look.skins ?? {}) };
    if (asset) skins[slot] = { asset, mode: skins[slot]?.mode ?? "ink" };
    else delete skins[slot];
    useLook.getState().setSkins(skins);
  },
  setMode: (slot: string, mode: InkMode) => {
    const skins = useLook.getState().look.skins ?? {};
    if (skins[slot]) useLook.getState().setSkins({ ...skins, [slot]: { ...skins[slot], mode } });
  },
  reset: () => useLook.getState().setSkins({}),
};

const skinView = (skins: Record<string, SkinEntry> | undefined): SkinView => ({ skins: skins ?? NO_SKINS, ...skinActions });

export function useSkins<T>(select: (s: SkinView) => T): T {
  return useLook((s) => select(skinView(s.look.skins)));
}

useSkins.getState = () => skinView(useLook.getState().look.skins);

export function Skin({ slot, size, children, className }: { slot: string; size: number; children: ReactNode; className?: string }) {
  const entry = useSkins((s) => s.skins[slot]);
  if (!entry) return <>{children}</>;
  return <InkImage asset={entry.asset} mode={entry.mode} size={size > 80 ? 320 : 160} className={className} style={{ width: size, height: size }} />;
}
