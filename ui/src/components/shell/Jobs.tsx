import { AnimatePresence, motion } from "motion/react";
import { Loader2, X } from "lucide-react";
import { Popover } from "radix-ui";
import { api } from "../../lib/api";
import { useRunningJobs } from "../../lib/events";
import { eta } from "../../lib/format";

export function JobsIndicator() {
  const jobs = useRunningJobs();
  const main = jobs[0];
  return (
    <AnimatePresence>
      {main && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex h-9 items-center gap-2.5 rounded-full bg-bg-2/80 pl-2.5 pr-3.5 text-[13px] text-fg-1 hairline backdrop-blur transition-colors hover:bg-bg-3"
            >
              <ProgressRing value={main.total ? (main.done ?? 0) / main.total : null} />
              <span className="max-w-[220px] truncate">{main.stage || main.label}</span>
              {jobs.length > 1 && <span className="text-fg-3">+{jobs.length - 1}</span>}
            </motion.button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              className="z-[70] w-[340px] rounded-xl bg-bg-3 p-3 elevated data-[state=open]:animate-[menu-in_180ms_var(--ease-out)]"
            >
              <div className="mb-2 px-1 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">Working in the background</div>
              <div className="flex flex-col gap-2">
                {jobs.map((job) => {
                  const pct = job.total ? Math.round(((job.done ?? 0) / job.total) * 100) : null;
                  return (
                    <div key={job.id} className="rounded-lg bg-bg-2 p-3 hairline">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-[13px] font-medium text-fg-0">{job.stage || job.label}</div>
                        <button
                          aria-label="Cancel"
                          onClick={() => api.cancelJob(job.id)}
                          className="grid h-6 w-6 place-items-center rounded-full text-fg-3 hover:bg-bg-4 hover:text-fg-0"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-4">
                        <motion.div
                          className="h-full rounded-full bg-accent"
                          initial={false}
                          animate={{ width: pct == null ? "30%" : `${pct}%` }}
                          transition={{ type: "spring", stiffness: 120, damping: 24 }}
                        />
                      </div>
                      <div className="mt-1.5 flex justify-between text-xs text-fg-3 tabular">
                        <span>{job.total ? `${job.done ?? 0} / ${job.total}` : "Starting…"}</span>
                        <span>{eta(job.eta_s)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </AnimatePresence>
  );
}

function ProgressRing({ value }: { value: number | null }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  if (value == null) return <Loader2 size={16} className="animate-spin text-accent" />;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <motion.circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c * (1 - value) }}
        transition={{ type: "spring", stiffness: 120, damping: 24 }}
      />
    </svg>
  );
}
