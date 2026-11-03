import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "charcoal" | "oled" | "light";
export type Motion = "full" | "reduced" | "off";
export type AccentMode = "brand" | "adaptive" | "custom";

export const ACCENTS_LIGHT: Record<string, string> = {
  amber: "oklch(0.52 0.14 62)",
  coral: "oklch(0.53 0.17 32)",
  rose: "oklch(0.52 0.17 2)",
  mint: "oklch(0.5 0.1 165)",
  sky: "oklch(0.5 0.13 245)",
  lilac: "oklch(0.5 0.15 300)",
};

export const ACCENTS: Record<string, string> = {
  amber: "oklch(0.81 0.135 76)",
  coral: "oklch(0.74 0.15 32)",
  rose: "oklch(0.74 0.13 2)",
  mint: "oklch(0.83 0.12 165)",
  sky: "oklch(0.78 0.11 235)",
  lilac: "oklch(0.76 0.11 300)",
};

type PrefsState = {
  theme: Theme;
  motion: Motion;
  accent: keyof typeof ACCENTS | string;
  accentMode: AccentMode;
  sidebarCollapsed: boolean;
  crossfade: number;
  ambient: boolean;
  defaultMode: string;
  outputDevice: string;
  recordHistory: boolean;
  fullSongs: boolean;
  launchSpotify: boolean;
  systemAudio: boolean;
  reasons: boolean;
  set: (patch: Partial<Omit<PrefsState, "set">>) => void;
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "charcoal",
      motion: "full",
      accent: "amber",
      accentMode: "adaptive",
      sidebarCollapsed: false,
      crossfade: 3,
      ambient: true,
      defaultMode: "similar",
      outputDevice: "",
      recordHistory: true,
      fullSongs: true,
      launchSpotify: true,
      systemAudio: true,
      reasons: true,
      set: (patch) => set(patch),
    }),
    { name: "cd-prefs" },
  ),
);

export function motionScale(motion: Motion) {
  return motion === "full" ? 1 : motion === "reduced" ? 0.5 : 0;
}
