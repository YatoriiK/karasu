import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { api, ApiError } from "../../lib/api";
import { useConnect } from "../../store/connect";
import { copyText } from "../../lib/clipboard";
import { openExternal } from "../../lib/tauri";
import type { Track } from "../../lib/types";
import { connectError, usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";

function patch(node: unknown, track: Track): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((item) => {
      const next = patch(item, track);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : node;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.id === track.id && "dz_id" in obj && "state" in obj) return { ...obj, state: track.state };
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const next = patch(v, track);
      if (next !== v) changed = true;
      out[k] = next;
    }
    return changed ? out : node;
  }
  return node;
}

export function patchTrackEverywhere(qc: QueryClient, track: Track) {
  for (const query of qc.getQueryCache().getAll()) {
    const data = query.state.data;
    if (data === undefined) continue;
    const next = patch(data, track);
    if (next !== data) qc.setQueryData(query.queryKey, next);
  }
  usePlayer.getState().patchTrack(track);
}

export function useTrackActions() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const feedback = async (track: Track, kind: "up" | "down" | "clear" | "never_artist") => {
    const optimistic: Track = {
      ...track,
      state: {
        ...track.state,
        liked: kind === "up",
        disliked: kind === "down",
        hidden: kind === "never_artist" ? true : track.state.hidden,
      },
    };
    patchTrackEverywhere(qc, optimistic);
    try {
      const res = await api.feedback(track.id, kind);
      if (res.track) patchTrackEverywhere(qc, res.track);
      if (kind === "never_artist") {
        toast(`You won't see ${track.artist.name} again`, {
          action: {
            label: "Undo",
            onClick: async () => {
              await api.removeExclusion("artist", track.artist.key);
              await api.feedback(track.id, "clear");
              qc.invalidateQueries();
            },
          },
        });
        qc.invalidateQueries({ queryKey: ["home"] });
      }
      if (kind === "down") toast("Got it, fewer songs like this");
    } catch (error) {
      patchTrackEverywhere(qc, track);
      toast("Couldn't save that", { description: (error as Error).message });
    }
  };

  return {
    play: (track: Track, list?: Track[], context?: { label: string; href?: string }) => {
      const player = usePlayer.getState();
      if (list && list.length) {
        const index = list.findIndex((t) => t.id === track.id);
        player.playList(list, Math.max(0, index), context ?? null);
      } else {
        player.playTrack(track, context ?? null);
      }
    },
    playNext: (track: Track) => usePlayer.getState().playNext(track),
    enqueue: (track: Track) => usePlayer.getState().enqueue([track]),
    like: async (track: Track) => {
      const on = !(track.state.liked || track.state.saved);
      const spotify = useConnect.getState().ready;
      const optimistic: Track = { ...track, state: { ...track.state, liked: on, disliked: false, saved: on ? track.state.saved || spotify : false } };
      patchTrackEverywhere(qc, optimistic);
      try {
        await api.feedback(track.id, on ? "up" : "clear");
        if (spotify) {
          try {
            const res = on ? await api.saveToSpotify(track.id) : await api.unsaveFromSpotify(track.id);
            patchTrackEverywhere(qc, { ...optimistic, sp_id: res.sp_id ?? optimistic.sp_id, state: { ...optimistic.state, saved: on } });
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) patchTrackEverywhere(qc, { ...optimistic, state: { ...optimistic.state, saved: false } });
            else connectError(error);
          }
        }
        qc.invalidateQueries({ queryKey: ["library", "saved"] });
      } catch (error) {
        patchTrackEverywhere(qc, track);
        toast("Couldn't save that", { description: (error as Error).message });
      }
    },
    dislike: (track: Track) => feedback(track, track.state.disliked ? "clear" : "down"),
    hideArtist: (track: Track) => feedback(track, "never_artist"),
    openSpotify: (track: Track) => {
      if (track.sp_id) openExternal(`https://open.spotify.com/track/${track.sp_id}`);
      else openExternal(`https://open.spotify.com/search/${encodeURIComponent(`${track.artist.name} ${track.title}`)}`);
    },
    addToPlaylist: (tracks: Track[]) => useUi.getState().set({ addToPlaylist: tracks.map((t) => t.id) }),
    saveToSpotify: async (track: Track) => {
      try {
        const res = await api.saveToSpotify(track.id);
        patchTrackEverywhere(qc, { ...track, sp_id: res.sp_id, state: { ...track.state, saved: true } });
        toast(`Saved to your Spotify library`, { description: `${track.artist.name} – ${track.title}` });
      } catch (error) {
        connectError(error);
      }
    },
    copyLink: async (track: Track) => {
      let url = track.sp_id ? `https://open.spotify.com/track/${track.sp_id}` : null;
      if (!url) {
        try {
          const links = await api.trackLinks(track.id);
          url = links.spotify ?? links.deezer;
        } catch {
          url = null;
        }
      }
      if (!url && track.dz_id) url = `https://www.deezer.com/track/${track.dz_id}`;
      if (!url) {
        toast("This song has no shareable link yet");
        return;
      }
      if (await copyText(url)) toast("Copied song link", { description: `${track.artist.name} – ${track.title}` });
      else toast("Couldn't reach the clipboard");
    },
    copy: async (text: string, what: string) => {
      if (await copyText(text)) toast(`Copied ${what}`, { description: text.length > 80 ? `${text.slice(0, 80)}…` : text });
      else toast("Couldn't reach the clipboard");
    },
    goAlbum: (track: Track) => {
      if (track.album.dz_id) navigate(`/album/${track.album.dz_id}`);
    },
    goTrack: (track: Track) => navigate(`/track/${encodeURIComponent(track.id)}`),
    goArtist: (track: Track) =>
      track.artist.dz_id
        ? navigate(`/artist/${track.artist.dz_id}`)
        : navigate(`/search?q=${encodeURIComponent(track.artist.name)}`),
  };
}
