import type { CSSProperties } from "react";
import type { Art } from "../../lib/types";
import { usePrefs } from "../../store/prefs";
import { AlbumArt } from "../music/AlbumArt";
import { cn } from "../ui/cn";

export type RecordKind = "vinyl" | "cd" | "tape";

function spin(seconds: number, on: boolean, still: boolean): CSSProperties {
  if (still) return {};
  return { animation: `karasu-spin ${seconds}s linear infinite`, animationPlayState: on ? "running" : "paused" };
}

function Label({ art, seed, size, className, rounded }: { art: Art | null | undefined; seed: string; size: number; className: string; rounded: string }) {
  if (art) return <AlbumArt art={art} seed={seed} size={size} className={className} rounded={rounded} />;
  return <div className={cn("seal grid place-items-center bg-bg-4 text-[9cqmin] text-fg-2", rounded, className)}>烏</div>;
}

export function Record({
  art,
  seed,
  spinning,
  kind = "vinyl",
  rpm = 33,
  tonearm = true,
  title,
  className,
}: {
  art: Art | null | undefined;
  seed: string;
  spinning: boolean;
  kind?: RecordKind;
  rpm?: number;
  tonearm?: boolean;
  title?: string;
  className?: string;
}) {
  const still = usePrefs((s) => s.motion) === "off";
  const period = 60 / Math.max(rpm, 1);
  if (kind === "tape") return <Tape art={art} seed={seed} spinning={spinning} still={still} title={title} className={className} />;
  return (
    <div className={cn("relative aspect-square [container-type:size]", className)}>
      <div
        className="absolute inset-[4%] overflow-hidden rounded-full shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]"
        style={{
          ...spin(kind === "cd" ? period / 3 : period, spinning, still),
          background:
            kind === "cd"
              ? "conic-gradient(from 0deg, #d9dde4, #f5e9ff, #c9f2ff, #fff6c9, #ffd9ec, #d9dde4, #e9fff3, #d9dde4)"
              : "repeating-radial-gradient(circle at 50% 50%, #0d0d0e 0 1.1px, #1a1a1c 1.1px 2.2px)",
        }}
      >
        {kind === "cd" ? (
          <Label art={art} seed={seed} size={420} className="absolute inset-[3%] h-[94%] w-[94%] opacity-85" rounded="rounded-full" />
        ) : (
          <>
            <div className="absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_rgb(255_255_255/0.05),inset_0_0_40px_rgb(0_0_0/0.8)]" />
            <Label art={art} seed={seed} size={240} className="absolute inset-[31%] h-[38%] w-[38%]" rounded="rounded-full" />
          </>
        )}
        <div className="absolute left-1/2 top-1/2 h-[3.2%] w-[3.2%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--paper)] shadow-[0_0_0_1px_rgb(0_0_0/0.4)]" />
        {kind === "cd" && <div className="absolute left-1/2 top-1/2 h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/20 bg-white/40" />}
      </div>
      <div
        className="pointer-events-none absolute inset-[4%] rounded-full"
        style={{
          background:
            kind === "cd"
              ? "conic-gradient(from 30deg, transparent 0 12%, rgb(255 255 255 / 0.55) 16%, transparent 22% 62%, rgb(255 255 255 / 0.4) 66%, transparent 72%)"
              : "conic-gradient(from 35deg, transparent 0 10%, rgb(255 255 255 / 0.09) 14%, transparent 19% 60%, rgb(255 255 255 / 0.07) 64%, transparent 69%)",
        }}
      />
      {tonearm && kind === "vinyl" && (
        <svg
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 h-full w-full transition-transform duration-[900ms] ease-[cubic-bezier(.16,1,.3,1)]"
          style={{ transformOrigin: "88% 12%", transform: `rotate(${spinning ? 0 : -24}deg)` }}
        >
          <circle cx="88" cy="12" r="5.2" fill="var(--bg-4)" stroke="var(--line-strong)" strokeWidth="0.6" />
          <circle cx="88" cy="12" r="2" fill="var(--fg-2)" />
          <path d="M88 12 L80 52 L66 70" fill="none" stroke="var(--fg-1)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="61.5" y="67.5" width="8" height="5" rx="1" transform="rotate(38 65.5 70)" fill="var(--fg-0)" />
        </svg>
      )}
    </div>
  );
}

function Reel({ spinning, still }: { spinning: boolean; still: boolean }) {
  return (
    <div className="relative aspect-square h-full rounded-full bg-[var(--paper)] shadow-[inset_0_0_0_2px_var(--line-strong)]" style={spin(2.4, spinning, still)}>
      {[0, 60, 120].map((deg) => (
        <div key={deg} className="absolute left-1/2 top-1/2 h-[70%] w-[12%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-2/70" style={{ rotate: `${deg}deg` }} />
      ))}
      <div className="absolute left-1/2 top-1/2 h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg-3 shadow-[0_0_0_1px_var(--line-strong)]" />
    </div>
  );
}

function Tape({ art, seed, spinning, still, title, className }: { art: Art | null | undefined; seed: string; spinning: boolean; still: boolean; title?: string; className?: string }) {
  return (
    <div className={cn("relative aspect-[1.6] [container-type:size]", className)}>
      <div className="absolute inset-0 rounded-[6%] bg-bg-3 shadow-[inset_0_0_0_1px_var(--line-strong),0_20px_50px_-20px_rgb(0_0_0/0.8)]">
        <div className="absolute inset-x-[6%] top-[7%] h-[34%] overflow-hidden rounded-[4%] bg-fg-0/90">
          <Label art={art} seed={seed} size={160} className="absolute left-0 top-0 h-full w-[28%]" rounded="rounded-none" />
          <div className="absolute inset-y-0 left-[31%] right-[3%] flex flex-col justify-center overflow-hidden text-bg-0">
            <div className="truncate font-mono text-[9cqh] font-semibold leading-tight">{title ?? "side a"}</div>
            <div className="mt-[3%] h-px w-full bg-bg-0/40" />
            <div className="mt-[3%] h-px w-[70%] bg-bg-0/30" />
          </div>
        </div>
        <div className="absolute inset-x-[18%] top-[48%] flex h-[30%] items-center justify-between rounded-[30cqh] bg-bg-0/70 px-[3%] shadow-[inset_0_0_0_1px_var(--line)]">
          <Reel spinning={spinning} still={still} />
          <div className="mx-[3%] h-[40%] flex-1 rounded-sm bg-fg-0/10" />
          <Reel spinning={spinning} still={still} />
        </div>
        <div className="absolute bottom-[5%] left-1/2 h-[9%] w-[46%] -translate-x-1/2 rounded-t-[30%] bg-bg-2 shadow-[inset_0_0_0_1px_var(--line)]" />
      </div>
    </div>
  );
}
