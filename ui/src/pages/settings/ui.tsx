import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Menu, MenuItem } from "../../components/ui/Menu";

export function Group({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-6">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-bg-2/70 hairline">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-[180px] flex-1">
        <div className="text-[14px] font-medium text-fg-0">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{hint}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  label: string;
  icon?: ReactNode;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Menu
      trigger={
        <button
          aria-label={label}
          className="flex h-9 max-w-[260px] items-center gap-2 rounded-lg bg-bg-3 px-3 text-[13px] font-medium text-fg-0 transition-colors hairline hover:bg-bg-4"
        >
          {icon}
          <span className="truncate">{current?.label ?? "—"}</span>
          <ChevronDown size={15} className="shrink-0 text-fg-2" />
        </button>
      }
    >
      {options.map((o) => (
        <MenuItem key={o.value} onSelect={() => onChange(o.value)} icon={o.value === value ? <Check size={14} className="text-accent" /> : <span />} hint={o.hint}>
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

