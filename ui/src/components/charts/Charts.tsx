import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { Slider as S } from "radix-ui";
import { EASE } from "../../lib/motion";
import { cn } from "../ui/cn";

export function Bars({
  values,
  labels,
  height = 140,
  highlightLast,
  format = (v: number) => String(v),
}: {
  values: number[];
  labels?: string[];
  height?: number;
  highlightLast?: boolean;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex w-full items-end gap-[3px]" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${Math.max((v / max) * 100, v ? 3 : 1.5)}%` }}
            transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.01, 0.4) }}
            className={cn(
              "w-full rounded-t-[4px] transition-colors",
              v ? (highlightLast && i === values.length - 1 ? "bg-accent" : "bg-fg-0/25 group-hover:bg-accent") : "bg-fg-0/[0.06]",
            )}
          />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-bg-4 px-2 py-1 text-2xs font-medium text-fg-0 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {labels?.[i] ? `${labels[i]} · ` : ""}
            {format(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HBars({ items, unit = "" }: { items: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1e-6, ...items.map((i) => Math.max(i.value, 0)));
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={item.label}>
          <div className="mb-1 flex justify-between text-[13px]">
            <span className="font-medium text-fg-1">{item.label}</span>
            <span className="text-fg-3 tabular">
              {unit === "%" ? `${Math.round(item.value)}%` : item.value.toLocaleString()}
              {unit && unit !== "%" ? ` ${unit}` : ""}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fg-0/[0.07]">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(Math.max(item.value, 0) / max) * 100}%` }}
              transition={{ duration: 0.8, ease: EASE, delay: i * 0.05 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TraitMeter({ label, value, left, right, note }: { label: string; value: number; left: string; right: string; note?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-fg-0">{label}</span>
        <span className="text-xs text-fg-2 tabular">{value}</span>
      </div>
      <div className="relative h-2 rounded-full bg-fg-0/[0.08]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 35%, transparent), var(--accent))" }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, ease: EASE }}
        />
      </div>
      <div className="mt-1 flex justify-between text-2xs text-fg-3">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      {note && <div className="mt-1 text-2xs text-fg-2">{note}</div>}
    </div>
  );
}

export function ScoreRing({ value, size = 120, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="8" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-bold tabular">{value}%</div>
          {label && <div className="text-2xs font-semibold uppercase tracking-wider text-fg-3">{label}</div>}
        </div>
      </div>
    </div>
  );
}

const LINE_COLORS = ["var(--accent)", "oklch(0.78 0.11 235)", "oklch(0.8 0.12 160)", "oklch(0.76 0.13 330)", "oklch(0.82 0.1 95)", "oklch(0.72 0.12 30)"];

export function Lines({ periods, series, height = 200 }: { periods: string[]; series: { label: string; values: number[] }[]; height?: number }) {
  const w = 720;
  const pad = { l: 8, r: 8, t: 10, b: 24 };
  const all = series.flatMap((s) => s.values);
  const y = scaleLinear()
    .domain([Math.min(...all, 0), Math.max(...all, 0.1)])
    .range([height - pad.b, pad.t]);
  const x = scaleLinear().domain([0, Math.max(periods.length - 1, 1)]).range([pad.l, w - pad.r]);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="3 4" />
        {series.map((s, si) => {
          const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
          return (
            <motion.path
              key={s.label}
              d={d}
              fill="none"
              stroke={LINE_COLORS[si % LINE_COLORS.length]}
              strokeWidth={si === 0 ? 2.5 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.1, ease: EASE, delay: si * 0.08 }}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-2xs text-fg-3">
        <span>{periods[0]}</span>
        <span>{periods[periods.length - 1]}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s, si) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-fg-2">
            <span className="h-2 w-2 rounded-full" style={{ background: LINE_COLORS[si % LINE_COLORS.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: [number, number];
  min: number;
  max: number;
  step: number;
  onChange: (v: [number, number]) => void;
  label: string;
}) {
  return (
    <S.Root
      className="group relative flex h-5 w-full touch-none select-none items-center"
      value={value}
      min={min}
      max={max}
      step={step}
      minStepsBetweenThumbs={1}
      aria-label={label}
      onValueChange={(v) => onChange([v[0], v[1]])}
    >
      <S.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-fg-0/12">
        <S.Range className="absolute h-full rounded-full bg-accent" />
      </S.Track>
      {[0, 1].map((i) => (
        <S.Thumb key={i} className="block h-4 w-4 rounded-full bg-fg-0 shadow-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      ))}
    </S.Root>
  );
}

export function StatTile({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="rounded-2xl bg-bg-2/70 p-4 hairline"
    >
      <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">{label}</div>
      <div className={cn("mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] tabular", accent && "text-accent")}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-fg-2">{sub}</div>}
    </motion.div>
  );
}
