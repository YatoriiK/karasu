import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTrackActions } from "../components/music/useTrackActions";
import { currentTrack, usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { playbackNow, playbackTotal } from "./usePlayback";

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Space"], label: "Play or pause" },
  { keys: ["Ctrl", "→"], label: "Next song" },
  { keys: ["Ctrl", "←"], label: "Previous song" },
  { keys: ["Shift", "→"], label: "Skip ahead 5 seconds" },
  { keys: ["Shift", "←"], label: "Go back 5 seconds" },
  { keys: ["Ctrl", "↑"], label: "Volume up" },
  { keys: ["Ctrl", "↓"], label: "Volume down" },
  { keys: ["M"], label: "Mute" },
  { keys: ["L"], label: "Like the current song" },
  { keys: ["S"], label: "Shuffle" },
  { keys: ["R"], label: "Repeat" },
  { keys: ["F"], label: "Now Playing" },
  { keys: ["Q"], label: "Queue" },
  { keys: ["Ctrl", "K"], label: "Search" },
  { keys: ["Ctrl", ","], label: "Settings" },
  { keys: ["?"], label: "Keyboard shortcuts" },
  { keys: ["Esc"], label: "Close panels" },
];

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function useShortcuts() {
  const navigate = useNavigate();
  const actions = useTrackActions();
  const qc = useQueryClient();
  const refs = useRef({ navigate, actions, qc });
  refs.current = { navigate, actions, qc };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return;
      const p = usePlayer.getState();
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;
      const el = e.target as HTMLElement | null;
      if (e.key === " " && !mod && !e.altKey) {
        if (el?.closest?.("button, a, [role=button], [role=menuitem], [role=tab], [role=option], [role=slider], [role=switch]")) return;
        e.preventDefault();
        if (currentTrack(p)) p.toggle();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey) {
        const step: Record<string, () => void> = {
          ArrowRight: () => p.next(),
          ArrowLeft: () => p.prev(),
          ArrowUp: () => p.setVolume(Math.min(1, p.volume + 0.1)),
          ArrowDown: () => p.setVolume(Math.max(0, p.volume - 0.1)),
          ",": () => refs.current.navigate("/settings"),
        };
        const fn = step[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
        return;
      }
      if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        if (el?.closest?.("[role=slider]") || !currentTrack(p)) return;
        e.preventDefault();
        const delta = e.key === "ArrowRight" ? 5 : -5;
        p.seek(Math.max(0, Math.min(playbackTotal() || 0, playbackNow() + delta)));
        return;
      }
      if (e.altKey || mod) return;
      if (e.key === "?") {
        e.preventDefault();
        ui.set({ shortcutsOpen: !ui.shortcutsOpen });
        return;
      }
      if (e.shiftKey) return;
      const track = currentTrack(p);
      switch (e.key.toLowerCase()) {
        case "m":
          p.toggleMute();
          break;
        case "l":
          if (track) refs.current.actions.like(track, refs.current.qc.getQueryData<boolean>(["liked", track.id]));
          break;
        case "s":
          p.toggleShuffle();
          break;
        case "r":
          p.cycleRepeat();
          break;
        case "f":
          if (track) ui.set({ nowPlaying: !ui.nowPlaying });
          break;
        case "q":
          ui.set({ queueOpen: !ui.queueOpen });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
