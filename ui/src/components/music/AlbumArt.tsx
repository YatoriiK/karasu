import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Disc3 } from "lucide-react";
import type { Art } from "../../lib/types";
import { artUrl, placeholderGradient } from "../../lib/art";
import { cn } from "../ui/cn";

export function AlbumArt({
  art,
  fallback,
  seed = "",
  size,
  className,
  rounded = "rounded-lg",
  layoutId,
  eager,
  alt = "",
}: {
  art: Art | null | undefined;
  fallback?: Art | null;
  seed?: string;
  size: number;
  className?: string;
  rounded?: string;
  layoutId?: string;
  eager?: boolean;
  alt?: string;
}) {
  const [bad, setBad] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const src = [artUrl(art, size), artUrl(fallback, size)].find((s) => s && !bad.includes(s));
  const palette = art?.palette ?? fallback?.palette;
  const base = palette
    ? `linear-gradient(135deg, ${palette.glow}, ${palette.base})`
    : placeholderGradient(seed || art?.ref || "x");

  useEffect(() => {
    if (!loaded || loaded === shown) return;
    const id = window.setTimeout(() => setShown(loaded), 520);
    return () => window.clearTimeout(id);
  }, [loaded, shown]);

  return (
    <motion.div
      layoutId={layoutId}
      className={cn("relative shrink-0 overflow-hidden bg-bg-3", rounded, rounded !== "rounded-full" && rounded !== "rounded-none" && "cover-art", className)}
      style={{ background: base }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
    >
      {src && shown && shown !== src && (
        <img src={shown} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setBad((list) => [...list, src])}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-[var(--ease-out)]",
            loaded === src ? "opacity-100 scale-100" : "opacity-0 scale-[1.02]",
          )}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-fg-0/50">
          <Disc3 size={Math.max(14, Math.min(size / 3.2, 64))} strokeWidth={1.4} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]" />
    </motion.div>
  );
}

export function Mosaic({ arts, size, className }: { arts: (Art | null | undefined)[]; size: number; className?: string }) {
  const tiles = arts.filter(Boolean).slice(0, 4) as Art[];
  if (tiles.length < 4) {
    return <AlbumArt art={tiles[0]} size={size} className={className} rounded="rounded-xl" />;
  }
  return (
    <div className={cn("cover-art grid grid-cols-2 grid-rows-2 overflow-hidden rounded-xl", className)}>
      {tiles.map((art, i) => (
        <AlbumArt key={i} art={art} size={size / 2} rounded="rounded-none" className="h-full w-full" />
      ))}
    </div>
  );
}
