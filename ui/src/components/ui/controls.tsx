import { motion } from "motion/react";
import { Slider as S, Switch } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onCommit,
  label,
  className,
  thin,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  label: string;
  className?: string;
  thin?: boolean;
}) {
  return (
    <S.Root
      className={cn("group relative flex h-5 touch-none select-none items-center", className ?? "w-full")}
      value={[value]}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onValueChange={(v) => onChange(v[0])}
      onValueCommit={(v) => onCommit?.(v[0])}
    >
      <S.Track
        className={cn(
          "relative grow overflow-hidden rounded-full bg-fg-0/12 transition-[height] duration-200",
          thin ? "h-1 group-hover:h-1.5" : "h-1.5 group-hover:h-2",
        )}
      >
        <S.Range className="absolute h-full rounded-full bg-fg-0 group-hover:bg-accent transition-colors duration-200" />
      </S.Track>
      <S.Thumb className="block h-3.5 w-3.5 scale-0 rounded-full bg-fg-0 shadow-md transition-transform duration-200 group-hover:scale-100 focus-visible:scale-100 focus:outline-none" />
    </S.Root>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300",
        checked ? "bg-accent" : "bg-bg-4",
      )}
    >
      <Switch.Thumb asChild>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 700, damping: 35 }}
          className={cn(
            "absolute top-0.5 block h-5 w-5 rounded-full shadow-sm",
            checked ? "right-0.5 bg-accent-fg" : "left-0.5 bg-fg-1",
          )}
        />
      </Switch.Thumb>
    </Switch.Root>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div className="inline-flex rounded-lg bg-bg-2 p-1 hairline" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative rounded-md font-medium transition-colors duration-200",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
            value === o.value ? "text-fg-0" : "text-fg-2 hover:text-fg-1",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-md bg-bg-4 shadow-sm"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({
  children,
  active,
  onClick,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-medium transition-colors duration-200",
        active ? "bg-fg-0 text-bg-0" : "bg-bg-3 text-fg-1 hover:bg-bg-4 hover:text-fg-0 hairline",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
