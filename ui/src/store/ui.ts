import { create } from "zustand";

type UiState = {
  nowPlaying: boolean;
  queueOpen: boolean;
  lyricsOpen: boolean;
  searchOpen: boolean;
  addToPlaylist: string[] | null;
  shortcutsOpen: boolean;
  wide: boolean;
  set: (patch: Partial<Omit<UiState, "set">>) => void;
};

export const useUi = create<UiState>((set) => ({
  nowPlaying: false,
  queueOpen: false,
  lyricsOpen: false,
  searchOpen: false,
  addToPlaylist: null,
  shortcutsOpen: false,
  wide: false,
  set: (patch) => set(patch),
}));
