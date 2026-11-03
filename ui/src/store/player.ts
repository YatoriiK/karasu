import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api";
import { spotifyArt } from "../lib/art";
import { engine } from "../player/engine";
import { nextPlayableIndex, shuffled } from "../player/queue";
import type { Art, Track } from "../lib/types";
import { ensureDevice, onConnectState, pollConnect, startConnectPolling, stopConnectPolling, useConnect } from "./connect";
import { usePrefs } from "./prefs";

export type Repeat = "off" | "all" | "one";
export type Source = "preview" | "spotify";
export type PlayContext = { label: string; href?: string; spotify?: string } | null;

type PlayerState = {
  queue: Track[];
  index: number;
  playing: boolean;
  buffering: boolean;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  context: PlayContext;
  order: number[];
  source: Source;
  deviceId: string | null;
  deviceName: string | null;
  playList: (tracks: Track[], start?: number, context?: PlayContext) => void;
  playTrack: (track: Track, context?: PlayContext) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  playNext: (track: Track) => void;
  enqueue: (tracks: Track[]) => void;
  removeAt: (queueIndex: number) => void;
  move: (from: number, to: number) => void;
  clearUpcoming: () => void;
  patchTrack: (track: Track) => void;
  setSource: (source: Source, device?: { id: string; name: string } | null) => void;
};

export const playablePreview = (t: Track) => !!t.dz_id && t.has_preview;
export const playableSpotify = (t: Track) => !!t.sp_id || !!t.dz_id;

export function connectError(error: unknown) {
  const message = error instanceof Error ? error.message : "Spotify didn't respond";
  if (error instanceof ApiError && (error.status === 401 || (error.status === 403 && /reconnect/i.test(message)))) {
    toast("Spotify needs permission", {
      description: "Reconnect once to let Karasu control playback.",
      action: { label: "Reconnect", onClick: () => api.spotifyLogin() },
    });
  } else if (error instanceof ApiError && error.status === 409) {
    toast("No active Spotify device", { description: "Open Spotify on this PC or your phone, then pick it under Devices." });
  } else {
    toast("Spotify couldn't play that", { description: message });
  }
}

let volumeTimer: number | null = null;

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      const spotifyPlay = async (queue: Track[], index: number) => {
        const context = get().context?.spotify ?? null;
        const lo = context ? 0 : Math.max(0, index - 20);
        const ids = (context ? queue : queue.slice(lo, lo + 100)).map((t) => t.id);
        const offset = index - lo;
        const shuffle = get().shuffle;
        set({ playing: true });
        startConnectPolling();
        try {
          await api.connectPlay(ids, offset, get().deviceId, null, context, shuffle);
          window.setTimeout(() => void pollConnect(), 700);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const waiting = toast.loading("Starting Spotify in the background…");
            const device = await ensureDevice();
            toast.dismiss(waiting);
            if (device) {
              set({ deviceId: device.id, deviceName: device.name });
              try {
                await api.connectPlay(ids, offset, device.id, null, context, shuffle);
                window.setTimeout(() => void pollConnect(), 700);
                return;
              } catch (retry) {
                error = retry;
              }
            }
          }
          set({ playing: false });
          connectError(error);
        }
      };

      const command = (action: string, value?: unknown) =>
        api
          .connectCommand(action, value)
          .then(() => window.setTimeout(() => void pollConnect(), 500))
          .catch(connectError);

      const ok = () => (get().source === "spotify" ? playableSpotify : playablePreview);

      return {
        queue: [],
        index: -1,
        playing: false,
        buffering: false,
        duration: 0,
        volume: 0.85,
        muted: false,
        shuffle: false,
        repeat: "off",
        context: null,
        order: [],
        source: "preview",
        deviceId: null,
        deviceName: null,

        playList: (tracks, start = 0, context = null) => {
          if (!tracks.length) return;
          const isOk = ok();
          let first = start;
          if (!isOk(tracks[first])) {
            const found = tracks.findIndex((t, i) => i >= start && isOk(t));
            if (found === -1) {
              toast("No preview available", { description: "Switch to Spotify under Devices to hear full songs." });
              return;
            }
            first = found;
          }
          const order = get().shuffle ? shuffled(tracks.length, first) : tracks.map((_, i) => i);
          set({ queue: tracks, index: first, order, context, playing: true });
          if (get().source === "spotify") spotifyPlay(tracks, first);
          else void engine.load(tracks[first], true);
        },

        playTrack: (track, context = null) => {
          const { queue, index } = get();
          const existing = queue.findIndex((t) => t.id === track.id);
          if (existing >= 0) {
            set({ index: existing, playing: true });
            if (get().source === "spotify") spotifyPlay(queue, existing);
            else void engine.load(queue[existing], true);
            return;
          }
          if (!ok()(track)) {
            toast("No preview available", { description: "Switch to Spotify under Devices to hear full songs." });
            return;
          }
          const insertAt = index + 1;
          const nextQueue = [...queue.slice(0, insertAt), track, ...queue.slice(insertAt)];
          set({ queue: nextQueue, index: insertAt, order: nextQueue.map((_, i) => i), context, playing: true });
          if (get().source === "spotify") spotifyPlay(nextQueue, insertAt);
          else void engine.load(track, true);
        },

        toggle: () => {
          const { playing, queue, index, source } = get();
          if (source === "spotify" && (index < 0 || !queue[index]) && useConnect.getState().state?.track) {
            set({ playing: !playing });
            void command(playing ? "pause" : "resume");
            return;
          }
          if (index < 0 || !queue[index]) return;
          if (source === "spotify") {
            set({ playing: !playing });
            void command(playing ? "pause" : "resume");
            return;
          }
          if (playing) {
            engine.pause();
            set({ playing: false });
          } else {
            if (!engine.currentTrack || engine.currentTrack.id !== queue[index].id) void engine.load(queue[index], true, false);
            else void engine.play();
            set({ playing: true });
          }
        },

        next: (auto = false) => {
          const { queue, index, order, repeat, source } = get();
          if (!queue.length) return;
          if (source === "spotify") {
            const target = nextPlayableIndex(queue, order, index, 1, repeat === "all", playableSpotify);
            if (target >= 0) set({ index: target });
            void command("next");
            return;
          }
          if (auto && repeat === "one") {
            void engine.load(queue[index], true, false);
            return;
          }
          const target = nextPlayableIndex(queue, order, index, 1, repeat === "all", playablePreview);
          if (target === -1) {
            if (auto) {
              engine.pause();
              set({ playing: false });
            }
            return;
          }
          set({ index: target, playing: true });
          void engine.load(queue[target], true, auto);
        },

        prev: () => {
          const { queue, index, order, source } = get();
          if (source === "spotify") {
            const target = nextPlayableIndex(queue, order, index, -1, false, playableSpotify);
            if (target >= 0) set({ index: target });
            void command("previous");
            return;
          }
          if (engine.currentTime > 3 || index < 0) {
            engine.seek(0);
            return;
          }
          const target = nextPlayableIndex(queue, order, index, -1, false, playablePreview);
          if (target === -1) {
            engine.seek(0);
            return;
          }
          set({ index: target, playing: true });
          void engine.load(queue[target], true, false);
        },

        seek: (seconds) => {
          if (get().source === "spotify") {
            const s = useConnect.getState().state;
            if (s) useConnect.setState({ state: { ...s, progress_ms: Math.round(seconds * 1000) }, at: performance.now() });
            void command("seek", Math.round(seconds * 1000));
            return;
          }
          engine.seek(seconds);
        },

        setVolume: (value) => {
          engine.setVolume(value);
          set({ volume: value, muted: value === 0 ? get().muted : false });
          engine.setMuted(value === 0 ? get().muted : false);
          if (get().source === "spotify") {
            if (volumeTimer !== null) window.clearTimeout(volumeTimer);
            volumeTimer = window.setTimeout(() => void command("volume", Math.round(value * 100)), 250);
          }
        },

        toggleMute: () => {
          const muted = !get().muted;
          engine.setMuted(muted);
          set({ muted });
          if (get().source === "spotify") void command("volume", muted ? 0 : Math.round(get().volume * 100));
        },

        toggleShuffle: () => {
          const { shuffle, queue, index, source } = get();
          const next = !shuffle;
          const order = next ? shuffled(queue.length, Math.max(index, 0)) : queue.map((_, i) => i);
          set({ shuffle: next, order });
          if (source === "spotify") void command("shuffle", next);
        },

        cycleRepeat: () => {
          const order: Repeat[] = ["off", "all", "one"];
          const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
          set({ repeat });
          if (get().source === "spotify") void command("repeat", repeat === "all" ? "context" : repeat === "one" ? "track" : "off");
        },

        playNext: (track) => {
          const { queue, index, order } = get();
          if (index < 0) {
            get().playList([track]);
            return;
          }
          const nextQueue = [...queue.slice(0, index + 1), track, ...queue.slice(index + 1)];
          const position = order.indexOf(index);
          const shiftedOrder = order.map((i) => (i > index ? i + 1 : i));
          shiftedOrder.splice(position + 1, 0, index + 1);
          set({ queue: nextQueue, order: shiftedOrder });
          if (get().source === "spotify") void command("queue", track.id);
          toast(`Playing next: ${track.title}`);
        },

        enqueue: (tracks) => {
          const { queue, order, index } = get();
          if (index < 0) {
            get().playList(tracks);
            return;
          }
          const start = queue.length;
          set({ queue: [...queue, ...tracks], order: [...order, ...tracks.map((_, i) => start + i)] });
          if (get().source === "spotify") tracks.slice(0, 20).forEach((t) => void command("queue", t.id));
          toast(tracks.length === 1 ? `Added to queue: ${tracks[0].title}` : `Added ${tracks.length} songs to queue`);
        },

        removeAt: (queueIndex) => {
          const { queue, index, order } = get();
          if (queueIndex === index) return;
          const nextQueue = queue.filter((_, i) => i !== queueIndex);
          const nextOrder = order.filter((i) => i !== queueIndex).map((i) => (i > queueIndex ? i - 1 : i));
          set({ queue: nextQueue, order: nextOrder, index: queueIndex < index ? index - 1 : index });
        },

        move: (from, to) => {
          const { queue, index } = get();
          if (from === to) return;
          const nextQueue = [...queue];
          const [item] = nextQueue.splice(from, 1);
          nextQueue.splice(to, 0, item);
          let nextIndex = index;
          if (from === index) nextIndex = to;
          else if (from < index && to >= index) nextIndex = index - 1;
          else if (from > index && to <= index) nextIndex = index + 1;
          set({ queue: nextQueue, index: nextIndex, order: nextQueue.map((_, i) => i), shuffle: false });
        },

        clearUpcoming: () => {
          const { queue, index } = get();
          const nextQueue = queue.slice(0, index + 1);
          set({ queue: nextQueue, order: nextQueue.map((_, i) => i) });
        },

        patchTrack: (track) => {
          set({ queue: get().queue.map((t) => (t.id === track.id ? track : t)) });
        },

        setSource: (source, device = null) => {
          const { queue, index, playing } = get();
          if (source === "spotify") {
            engine.pause();
            set({ source, deviceId: device?.id ?? null, deviceName: device?.name ?? null });
            startConnectPolling();
            if (device?.id) {
              if (queue[index] && playing) spotifyPlay(queue, index);
              else void command("transfer", device.id);
            }
            toast(`Playing full songs on ${device?.name ?? "Spotify"}`);
          } else {
            if (get().source === "spotify") void api.connectCommand("pause").catch(() => undefined);
            stopConnectPolling();
            set({ source: "preview", deviceId: null, deviceName: null, playing: false });
            toast("Back to in-app previews");
          }
        },
      };
    },
    {
      name: "cd-player",
      partialize: (s) => ({
        queue: s.queue.slice(0, 300),
        index: s.index,
        volume: s.volume,
        muted: s.muted,
        shuffle: s.shuffle,
        repeat: s.repeat,
        context: s.context,
        order: s.order.slice(0, 300),
        source: s.source,
        deviceId: s.deviceId,
        deviceName: s.deviceName,
      }),
    },
  ),
);

const plainTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();

function sameSong(queue: Track[], t: { title: string; artist: string }) {
  const title = plainTitle(t.title);
  const artists = t.artist.toLowerCase();
  return queue.findIndex((q) => plainTitle(q.title) === title && artists.includes(q.artist.name.toLowerCase()));
}

function trackFromConnect(t: NonNullable<import("../lib/types").ConnectState["track"]>): Track {
  return {
    id: `sp:${t.sp_id}`,
    dz_id: null,
    sp_id: t.sp_id,
    sp_uri: t.uri,
    title: t.title,
    artist: { name: t.artist, key: t.artist.toLowerCase(), dz_id: null },
    album: { title: t.album, dz_id: null },
    year: null,
    year_source: null,
    duration_s: Math.round(t.duration_ms / 1000),
    art: spotifyArt(t.image),
    has_preview: false,
    facets: { energy: null, tempo: null, top: [], genres: [] },
    popularity: { fans: null, tier: null },
    state: { liked: false, disliked: false, hidden: false, saved: false },
    reasons: [],
    score: null,
  };
}

export function currentTrack(state: PlayerState): Track | undefined {
  return state.index >= 0 ? state.queue[state.index] : undefined;
}

export function upcomingTrack(state: PlayerState): Track | undefined {
  const at = state.order.indexOf(state.index);
  const next = at >= 0 ? state.order[at + 1] : undefined;
  return next === undefined ? undefined : state.queue[next];
}

export function useLiveArt(track: Track | undefined): Art | null {
  const spotify = usePlayer((s) => s.source === "spotify");
  const image = useConnect((s) => s.state?.track?.image ?? null);
  const spId = useConnect((s) => s.state?.track?.sp_id ?? null);
  const title = useConnect((s) => s.state?.track?.title ?? null);
  if (!track || !spotify || !image) return null;
  const same = (!!track.sp_id && track.sp_id === spId) || (!!title && plainTitle(title) === plainTitle(track.title));
  return same ? spotifyArt(image) : null;
}

let wired = false;

export function wirePlayerEngine() {
  if (wired) return;
  wired = true;
  const { volume, muted, source } = usePlayer.getState();
  engine.setVolume(volume);
  engine.setMuted(muted);
  usePlayer.setState({ playing: false });
  if (source === "spotify") startConnectPolling();
  let logged = "";
  window.setInterval(() => {
    const s = usePlayer.getState();
    const t = currentTrack(s);
    if (s.source !== "preview" || !s.playing || !t || logged === t.id) return;
    if (engine.currentTime >= 10) {
      logged = t.id;
      if (!usePrefs.getState().recordHistory) return;
      void api.playEvent(t.id, Math.round(engine.currentTime * 1000)).catch(() => undefined);
    }
  }, 2000);
  onConnectState((state) => {
    const store = usePlayer.getState();
    if (store.source !== "spotify") return;
    const patch: Partial<PlayerState> = { playing: !!state.is_playing };
    const spId = state.track?.sp_id;
    if (spId && state.track) {
      let found = store.queue.findIndex((t) => t.sp_id === spId || t.id === `sp:${spId}`);
      if (found < 0) found = sameSong(store.queue, state.track);
      if (found >= 0 && found !== store.index) patch.index = found;
      if (found < 0) {
        patch.queue = [trackFromConnect(state.track)];
        patch.index = 0;
        patch.order = [0];
        patch.context = { label: "Spotify" };
      }
    }
    usePlayer.setState(patch);
  });
  engine.on((event) => {
    const store = usePlayer.getState();
    if (store.source === "spotify") return;
    switch (event.type) {
      case "playing":
        usePlayer.setState({ playing: event.value, buffering: false });
        break;
      case "buffering":
        usePlayer.setState({ buffering: event.value });
        break;
      case "loaded":
        usePlayer.setState({ duration: event.duration });
        break;
      case "nearEnd":
      case "ended":
        store.next(true);
        break;
      case "error":
        toast(event.message, { description: event.track ? `${event.track.artist.name} – ${event.track.title}` : undefined });
        usePlayer.setState({ playing: false, buffering: false });
        break;
    }
  });
}

export function usePlayable() {
  return usePlayer((s) => (s.source === "spotify" ? playableSpotify : playablePreview));
}
