import type { ReactNode } from "react";
import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./Button";
import { EASE } from "../../lib/motion";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      <div className="relative mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-bg-2 text-fg-1 hairline">
        <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_50%_0%,var(--accent-soft),transparent_70%)]" />
        <span className="relative">{icon}</span>
      </div>
      <h3 className="text-lg font-semibold text-fg-0 text-balance">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-fg-2 text-balance">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <EmptyState
      icon={<RefreshCw size={22} />}
      title="That didn't load"
      body={message}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry} icon={<RefreshCw size={14} />}>
            Try again
          </Button>
        )
      }
    />
  );
}

export function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-3.5 items-end gap-[2px]", className)} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-accent"
          animate={playing ? { height: ["30%", "100%", "45%", "85%", "30%"] } : { height: "30%" }}
          transition={playing ? { duration: 1 + i * 0.17, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
        />
      ))}
    </span>
  );
}

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("seal relative inline-grid shrink-0 place-items-center bg-fg-0 text-bg-0", className)}
      style={{ width: size, height: size, fontSize: size * 0.74, borderRadius: `calc(${Math.max(2, size * 0.14)}px * var(--round))` }}
    >
      <span className="translate-y-[3%]">烏</span>
      <span className="pointer-events-none absolute inset-[9%] border border-bg-0/45" style={{ borderRadius: `calc(${Math.max(1, size * 0.08)}px * var(--round))` }} />
    </span>
  );
}
