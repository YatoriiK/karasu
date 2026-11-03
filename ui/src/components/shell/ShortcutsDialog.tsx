import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { Keyboard, X } from "lucide-react";
import { SHORTCUTS } from "../../hooks/useShortcuts";
import { GLOBAL_ACTIONS, keyLabels, useGlobalKeys } from "../../hooks/useGlobalShortcuts";
import { useUi } from "../../store/ui";
import { IconButton } from "../ui/Button";

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="grid h-6 min-w-6 place-items-center rounded-md bg-bg-4 px-1.5 font-sans text-[11.5px] font-semibold text-fg-1 shadow-[inset_0_-1px_0_var(--line-strong)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutList() {
  return (
    <ul className="grid gap-x-8 sm:grid-cols-2">
      {SHORTCUTS.map((s) => (
        <li key={s.label} className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-[13.5px] text-fg-1">
          <span>{s.label}</span>
          <Keys keys={s.keys} />
        </li>
      ))}
    </ul>
  );
}

function GlobalList() {
  const enabled = useGlobalKeys((s) => s.enabled);
  const bindings = useGlobalKeys((s) => s.bindings);
  const set = GLOBAL_ACTIONS.filter((a) => bindings[a.id]);
  if (!enabled || !set.length) return null;
  return (
    <div className="mt-6">
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-fg-3">Anywhere, even in games</div>
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {set.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-[13.5px] text-fg-1">
            <span>{a.label}</span>
            <Keys keys={keyLabels(bindings[a.id])} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.set);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => set({ shortcutsOpen: v })}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[75] bg-[var(--scrim)] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed left-1/2 top-1/2 z-[76] max-h-[calc(100vh-48px)] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-bg-2 p-6 elevated"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <Dialog.Title className="flex items-center gap-2.5 text-lg font-semibold">
                    <Keyboard size={19} className="text-accent" /> Keyboard shortcuts
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <IconButton label="Close" size="sm" round>
                      <X size={16} />
                    </IconButton>
                  </Dialog.Close>
                </div>
                <ShortcutList />
                <GlobalList />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
