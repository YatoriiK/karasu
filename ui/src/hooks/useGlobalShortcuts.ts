import { useEffect, useRef } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IN_TAURI } from "../lib/api";
import { useTrackActions } from "../components/music/useTrackActions";
import { currentTrack, usePlayer } from "../store/player";

export type GlobalAction = "playPause" | "next" | "prev" | "volumeUp" | "volumeDown" | "mute" | "like";

export const GLOBAL_ACTIONS: { id: GlobalAction; label: string; keys: string }[] = [
  { id: "playPause", label: "Play or pause", keys: "Ctrl+Alt+Space" },
  { id: "next", label: "Next song", keys: "Ctrl+Alt+ArrowRight" },
  { id: "prev", label: "Previous song", keys: "Ctrl+Alt+ArrowLeft" },
  { id: "volumeUp", label: "Volume up", keys: "Ctrl+Alt+ArrowUp" },
  { id: "volumeDown", label: "Volume down", keys: "Ctrl+Alt+ArrowDown" },
  { id: "mute", label: "Mute", keys: "Ctrl+Alt+KeyM" },
  { id: "like", label: "Like the current song", keys: "Ctrl+Alt+KeyL" },
];

export const DEFAULT_BINDINGS = Object.fromEntries(GLOBAL_ACTIONS.map((a) => [a.id, a.keys])) as Record<GlobalAction, string>;

type Result = { action: string; ok: boolean; error: string | null };

type GlobalKeysState = {
  enabled: boolean;
  bindings: Record<GlobalAction, string>;
  recording: GlobalAction | null;
  results: Record<string, Result>;
  set: (patch: Partial<Pick<GlobalKeysState, "enabled" | "bindings" | "recording" | "results">>) => void;
  bind: (action: GlobalAction, keys: string) => void;
};

export const useGlobalKeys = create<GlobalKeysState>()(
  persist(
    (set) => ({
      enabled: false,
      bindings: DEFAULT_BINDINGS,
      recording: null,
      results: {},
      set: (patch) => set(patch),
      bind: (action, keys) =>
        set((s) => {
          const bindings = { ...s.bindings, [action]: keys };
          if (keys) {
            for (const other of Object.keys(bindings) as GlobalAction[]) {
              if (other !== action && bindings[other] === keys) bindings[other] = "";
            }
          }
          return { bindings };
        }),
    }),
    {
      name: "karasu-global-keys",
      partialize: (s) => ({ enabled: s.enabled, bindings: s.bindings }),
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<GlobalKeysState>;
        return { ...current, ...s, bindings: { ...DEFAULT_BINDINGS, ...(s.bindings ?? {}) } };
      },
    },
  ),
);

const MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);
const ALONE = /^(F\d{1,2}|Media\w+|AudioVolume\w+|Pause|ScrollLock|Insert)$/;

export function keysFromEvent(e: KeyboardEvent): { keys: string | null; reason?: string } {
  if (MODIFIERS.has(e.key) || !e.code) return { keys: null };
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  // A lone K as a global shortcut would eat every K you type in Discord. F-keys and media keys are fine.
  if (!mods.length && !ALONE.test(e.code)) {
    return { keys: null, reason: "Hold Ctrl, Alt or Shift too, so games and other apps still get that key." };
  }
  if (mods.length === 1 && mods[0] === "Shift" && !ALONE.test(e.code)) {
    return { keys: null, reason: "Shift alone would block typing capitals. Add Ctrl or Alt." };
  }
  return { keys: [...mods, e.code].join("+") };
}

const NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
  MediaPlayPause: "Play/Pause",
  MediaTrackNext: "Next track",
  MediaTrackPrevious: "Prev track",
  MediaStop: "Stop",
  AudioVolumeUp: "Vol +",
  AudioVolumeDown: "Vol −",
  AudioVolumeMute: "Vol mute",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Backslash: "\\",
  Super: "Win",
};

export function keyLabels(keys: string): string[] {
  if (!keys) return [];
  return keys.split("+").map((k) => NAMES[k] ?? k.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num "));
}

export function useGlobalShortcuts() {
  const enabled = useGlobalKeys((s) => s.enabled);
  const bindings = useGlobalKeys((s) => s.bindings);
  const recording = useGlobalKeys((s) => s.recording);
  const actions = useTrackActions();
  const like = useRef(actions.like);
  like.current = actions.like;

  useEffect(() => {
    if (!IN_TAURI) return;
    let alive = true;
    // Let go of everything while recording, or pressing the new combo would also fire the old one.
    const list = enabled && !recording ? (Object.entries(bindings) as [GlobalAction, string][]).filter(([, keys]) => keys) : [];
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const out = await invoke<Result[]>("set_global_shortcuts", { bindings: list.map(([action, keys]) => ({ action, keys })) });
        if (alive && !recording) useGlobalKeys.getState().set({ results: Object.fromEntries(out.map((r) => [r.action, r])) });
      } catch {
        /* older desktop shell without global shortcuts */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, bindings, recording]);

  useEffect(() => {
    if (!IN_TAURI) return;
    let stop: (() => void) | null = null;
    let alive = true;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("global-shortcut", (event) => {
        const p = usePlayer.getState();
        const track = currentTrack(p);
        switch (event.payload as GlobalAction) {
          case "playPause":
            if (track) p.toggle();
            break;
          case "next":
            p.next();
            break;
          case "prev":
            p.prev();
            break;
          case "volumeUp":
            p.setVolume(Math.min(1, p.volume + 0.1));
            break;
          case "volumeDown":
            p.setVolume(Math.max(0, p.volume - 0.1));
            break;
          case "mute":
            p.toggleMute();
            break;
          case "like":
            if (track) like.current(track);
            break;
        }
      }).then((un) => {
        if (alive) stop = un;
        else un();
      }),
    );
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
}
