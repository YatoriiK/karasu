import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { IN_TAURI } from "../../lib/api";
import { DEFAULT_BINDINGS, GLOBAL_ACTIONS, keyLabels, keysFromEvent, useGlobalKeys, type GlobalAction } from "../../hooks/useGlobalShortcuts";
import { Keys } from "../../components/shell/ShortcutsDialog";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/controls";
import { cn } from "../../components/ui/cn";
import { Group, Row } from "./ui";

function Recorder({ action }: { action: GlobalAction }) {
  const keys = useGlobalKeys((s) => s.bindings[action]);
  const recording = useGlobalKeys((s) => s.recording === action);
  const set = useGlobalKeys((s) => s.set);
  const bind = useGlobalKeys((s) => s.bind);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (plain && e.key === "Escape") {
        set({ recording: null });
        return;
      }
      if (plain && (e.key === "Backspace" || e.key === "Delete")) {
        bind(action, "");
        set({ recording: null });
        return;
      }
      const got = keysFromEvent(e);
      if (got.keys) {
        bind(action, got.keys);
        set({ recording: null });
      } else if (got.reason) {
        setHint(got.reason);
      }
    };
    const cancel = () => set({ recording: null });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", cancel);
      setHint(null);
    };
  }, [recording, action, set, bind]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => set({ recording: recording ? null : action })}
        data-recorder={action}
        className={cn(
          "flex h-9 min-w-[168px] items-center justify-center rounded-lg px-3 hairline transition-colors",
          recording ? "bg-accent/15 shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-bg-3/70 hover:bg-bg-4",
        )}
        title={recording ? "Press the keys, Esc to cancel, Backspace to clear" : "Click, then press the keys you want"}
      >
        {recording ? (
          <span className="animate-pulse text-[12.5px] text-fg-0">Press keys…</span>
        ) : keys ? (
          <Keys keys={keyLabels(keys)} />
        ) : (
          <span className="text-[12.5px] text-fg-3">Not set</span>
        )}
      </button>
      {recording && <span className="max-w-[260px] text-right text-[11.5px] text-fg-3">{hint ?? "Esc cancels · Backspace clears"}</span>}
    </div>
  );
}

export function GlobalKeys() {
  const enabled = useGlobalKeys((s) => s.enabled);
  const results = useGlobalKeys((s) => s.results);
  const bindings = useGlobalKeys((s) => s.bindings);
  const set = useGlobalKeys((s) => s.set);
  const bind = useGlobalKeys((s) => s.bind);
  const changed = GLOBAL_ACTIONS.some((a) => bindings[a.id] !== DEFAULT_BINDINGS[a.id]);

  return (
    <Group
      id="anywhere"
      title="Shortcuts in other apps"
      description="Control Karasu while you're in a game or another app, even without media keys. Karasu takes these key combinations for itself while this is on, so other apps won't receive them."
    >
      <Row
        label="Use shortcuts anywhere"
        hint={IN_TAURI ? "Works while Karasu is in the background or minimized" : "Only works in the Karasu desktop app"}
      >
        <Toggle checked={enabled} onChange={(value) => set({ enabled: value })} label="Use shortcuts anywhere" />
      </Row>
      <div className={cn("transition-opacity", !enabled && "pointer-events-none opacity-45")} aria-disabled={!enabled}>
        {GLOBAL_ACTIONS.map((a) => {
          const result = enabled && bindings[a.id] ? results[a.id] : undefined;
          return (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line px-5 py-3" data-global-row={a.id}>
              <div className="min-w-[160px] flex-1">
                <div className="text-[14px] font-medium text-fg-0">{a.label}</div>
                {result && !result.ok && (
                  <div className="mt-0.5 text-[12.5px] text-bad" data-global-error>
                    Another app is already using this combination. Pick a different one.
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Recorder action={a.id} />
                {bindings[a.id] && (
                  <button
                    aria-label={`Clear ${a.label}`}
                    onClick={() => bind(a.id, "")}
                    className="grid h-9 w-9 place-items-center rounded-lg text-fg-3 hover:bg-bg-3 hover:text-fg-0"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-[12.5px] text-fg-3">Click a box, then press the keys. Combinations with Ctrl or Alt are safest in games.</span>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={!changed} onClick={() => set({ bindings: DEFAULT_BINDINGS })}>
            Defaults
          </Button>
        </div>
      </div>
    </Group>
  );
}
