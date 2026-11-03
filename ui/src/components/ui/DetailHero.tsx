import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { Art, Palette } from "../../lib/types";
import { EASE } from "../../lib/motion";
import { AlbumArt, Mosaic } from "../music/AlbumArt";
import { useTint } from "../../theme/look";

export function DetailHero({
  art,
  arts,
  palette,
  round,
  eyebrow,
  title,
  meta,
  actions,
  children,
  seed,
}: {
  art?: Art | null;
  arts?: (Art | null | undefined)[];
  palette?: Palette | null;
  round?: boolean;
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  seed?: string;
}) {
  const tint = useTint();
  return (
    <header className="relative -mx-6 mb-8 px-6 pb-8 pt-6 md:-mx-8 md:px-8">
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 bottom-0 -z-0"
        style={{
          background: palette
            ? `linear-gradient(180deg, color-mix(in srgb, ${palette.glow} 55%, transparent) 0%, transparent 100%)`
            : "linear-gradient(180deg, color-mix(in srgb, var(--art-glow) 30%, transparent), transparent)",
          ...tint,
        }}
      />
      <div className="relative flex flex-col gap-7 md:flex-row md:items-end">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="w-[min(232px,60vw)] shrink-0"
        >
          {arts ? (
            <Mosaic arts={arts} size={232} className="aspect-square w-full shadow-[0_30px_70px_-26px_rgb(0_0_0/0.9)]" />
          ) : (
            <AlbumArt
              art={art}
              seed={seed}
              size={232}
              eager
              rounded={round ? "rounded-full" : "rounded-2xl"}
              className="aspect-square w-full shadow-[0_30px_70px_-26px_rgb(0_0_0/0.9)]"
            />
          )}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.06 }}
          className="min-w-0 flex-1"
        >
          {eyebrow && <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.16em] text-fg-2">{eyebrow}</div>}
          <h1 className="text-balance text-[clamp(30px,4.6vw,64px)] font-bold leading-[0.98] tracking-[-0.04em] text-fg-0">{title}</h1>
          {meta && <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-fg-1">{meta}</div>}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>}
          {children}
        </motion.div>
      </div>
    </header>
  );
}
