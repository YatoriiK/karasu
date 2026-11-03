import { createContext, useContext } from "react";
import type { Track } from "../../lib/types";

export const PlaylistEditContext = createContext<{ remove: (track: Track) => void } | null>(null);

export const usePlaylistEdit = () => useContext(PlaylistEditContext);
