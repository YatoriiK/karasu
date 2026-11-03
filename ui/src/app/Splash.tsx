import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Logo } from "../components/ui/states";

export function Splash({ status, error, children }: { status: string; error?: string | null; children?: ReactNode }) {
  return (
    <div className="grain fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-paper py-8 text-fg-0">
      <div className="relative flex flex-col items-center">
        <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 20 }}>
          <Logo size={72} />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="ink-glow mt-6 text-3xl font-bold tracking-[-0.01em]"
        >
          karasu
        </motion.h1>
        {children}
        {!children && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-2 font-mono text-[13px] text-fg-2">
            {status}
          </motion.p>
        )}
        {!children && error && (
          <motion.pre
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="selectable mt-5 max-w-[560px] whitespace-pre-wrap rounded-md bg-bg-2 p-4 text-left font-mono text-xs leading-relaxed text-fg-1 hairline"
          >
            {error}
          </motion.pre>
        )}
        {!children && !error && (
          <div className="mt-6 h-px w-48 overflow-hidden bg-fg-0/15">
            <motion.div className="h-full w-1/3 bg-fg-0" animate={{ x: ["-100%", "320%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }} />
          </div>
        )}
      </div>
    </div>
  );
}
