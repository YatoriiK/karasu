import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { useJob } from "../../lib/events";
import { openExternal } from "../../lib/tauri";
import type { SetupState } from "../../lib/types";
import { Button } from "../../components/ui/Button";
import { cn } from "../../components/ui/cn";

export function StepTitle({ kicker, title, lead }: { kicker: string; title: string; lead: ReactNode }) {
  return (
    <header>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">{kicker}</div>
      <h1 className="mt-2 text-[30px] font-bold leading-tight tracking-[-0.03em] md:text-[34px]">{title}</h1>
      <div className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-fg-2">{lead}</div>
    </header>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="mt-8 space-y-3">{children}</ol>;
}

export function Item({ n, title, done, children }: { n: number; title: ReactNode; done?: boolean; children?: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-2xl bg-bg-2/70 p-5 hairline">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[12px] font-semibold",
          done ? "bg-good/20 text-good" : "bg-fg-0 text-bg-0",
        )}
      >
        {done ? <Check size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="pt-0.5 text-[15px] font-semibold text-fg-0">{title}</div>
        {children && <div className="mt-1.5 space-y-3 text-[14px] leading-relaxed text-fg-2">{children}</div>}
      </div>
    </li>
  );
}

export function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-fg-0">{children}</span>;
}

export function CopyField({ label, value, note, strong }: { label: string; value: string; note?: ReactNode; strong?: boolean }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-fg-3">{label}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 rounded-lg bg-bg-3/70 py-1 pl-3 pr-1 hairline",
          strong && "shadow-[inset_0_0_0_1px_var(--accent)]",
        )}
      >
        <code className="selectable min-w-0 flex-1 truncate font-mono text-[13px] text-fg-0">{value}</code>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy size={13} />}
          aria-label={`Copy ${label}`}
          onClick={async () => toast((await copyText(value)) ? `Copied ${label.toLowerCase()}` : "Couldn't copy. Select it and press Ctrl+C.")}
        >
          Copy
        </Button>
      </div>
      {note && <div className="mt-1 text-[12.5px] text-fg-3">{note}</div>}
    </div>
  );
}

export function OpenButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Button variant={variant} icon={<ExternalLink size={15} />} onClick={() => openExternal(href)}>
      {children}
    </Button>
  );
}

export function Nav({ back, next }: { back?: () => void; next?: ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {back ? (
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
}

type Result = { songs?: number; new?: number; artists?: number };

function summary(result: Result | undefined) {
  if (!result) return "Ready";
  const parts = [];
  if (result.songs) parts.push(`learned from ${result.songs} songs`);
  if (result.new) parts.push(`found ${result.new} new ones to start with`);
  return parts.length ? `Ready: ${parts.join(", ")}` : "Ready";
}

export function JobProgress({ job, note }: { job: SetupState["job"]; note?: string }) {
  const live = useJob(job?.id);
  const current = live ?? job;
  const finished = current?.status === "done";
  const { data: full } = useQuery({
    queryKey: ["job", current?.id],
    queryFn: () => api.job(current!.id),
    enabled: !!current?.id && finished,
    staleTime: Infinity,
  });
  if (!current) return null;
  const total = current.total ?? 0;
  const done = current.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  const failed = current.status === "error" || current.status === "cancelled" || current.status === "interrupted";
  return (
    <div className="rounded-xl bg-bg-3/60 p-4 hairline" data-setup-job={current.status}>
      <div className="flex items-center justify-between gap-3 text-[13.5px]">
        <span className="font-medium text-fg-0">
          {finished ? summary(full?.result as Result | undefined) : failed ? "This stopped before it finished" : current.stage || "Working…"}
        </span>
        {pct !== null && !finished && !failed && (
          <span className="shrink-0 font-mono text-[12px] tabular text-fg-2">
            {done.toLocaleString()} / {total.toLocaleString()}
          </span>
        )}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-fg-0/10">
        {finished ? (
          <div className="h-full w-full bg-good" />
        ) : failed ? (
          <div className="h-full w-full bg-bad/60" />
        ) : pct !== null ? (
          <motion.div className="h-full bg-fg-0" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
        ) : (
          <motion.div
            className="h-full w-1/3 bg-fg-0"
            animate={{ x: ["-100%", "320%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }}
          />
        )}
      </div>
      {failed && <p className="mt-2 text-[12.5px] text-bad">{current.error || "Try again, or carry on and Karasu will pick it up later."}</p>}
      {note && !finished && !failed && <p className="mt-2 text-[12.5px] text-fg-3">{note}</p>}
    </div>
  );
}
