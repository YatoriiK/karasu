import { useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useTransform } from "motion/react";
import { duration as fmt } from "../../lib/format";
import { useSharedPlayback } from "../../hooks/usePlayback";
import { usePlayer } from "../../store/player";
import { cn } from "../ui/cn";

export function Seekbar({ className, large }: { className?: string; large?: boolean }) {
  const { time, duration } = useSharedPlayback();
  const seek = usePlayer((s) => s.seek);
  const track = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const total = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const progress = useTransform(() => {
    const d = duration.get();
    return d > 0 ? Math.min(1, time.get() / d) : 0;
  });
  const width = useTransform(progress, (p) => `${(drag ?? p) * 100}%`);

  useMotionValueEvent(time, "change", (t) => {
    if (elapsed.current && drag == null) elapsed.current.textContent = fmt(t);
  });
  useMotionValueEvent(duration, "change", (d) => {
    if (total.current) total.current.textContent = d > 0 ? fmt(d) : "0:00";
  });
  useEffect(() => {
    if (elapsed.current) elapsed.current.textContent = fmt(time.get());
    if (total.current) total.current.textContent = duration.get() > 0 ? fmt(duration.get()) : "0:00";
  }, [time, duration]);

  const fraction = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  return (
    <div className={cn("flex w-full items-center gap-2.5", className)}>
      <span ref={elapsed} className={cn("w-10 text-right text-xs text-fg-2 tabular", large && "text-[13px]")}>
        0:00
      </span>
      <div
        ref={track}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        className="group relative flex h-4 flex-1 cursor-pointer items-center"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDrag(fraction(e.clientX));
        }}
        onPointerMove={(e) => drag != null && setDrag(fraction(e.clientX))}
        onPointerUp={(e) => {
          if (drag != null) {
            const f = fraction(e.clientX);
            seek(f * duration.get());
            setDrag(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(time.get() + 5);
          if (e.key === "ArrowLeft") seek(time.get() - 5);
        }}
      >
        <div className={cn("relative w-full overflow-hidden rounded-full bg-fg-0/14 transition-[height] duration-200", large ? "h-1.5 group-hover:h-2" : "h-1 group-hover:h-1.5")}>
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-fg-0 group-hover:bg-accent" style={{ width }} />
        </div>
        <motion.div
          className={cn(
            "pointer-events-none absolute top-1/2 -ml-1.5 h-3 w-3 -translate-y-1/2 rounded-full bg-fg-0 shadow transition-transform duration-200",
            drag != null ? "scale-100" : "scale-0 group-hover:scale-100",
          )}
          style={{ left: width }}
        />
      </div>
      <span ref={total} className={cn("w-10 text-xs text-fg-2 tabular", large && "text-[13px]")}>
        0:00
      </span>
    </div>
  );
}
