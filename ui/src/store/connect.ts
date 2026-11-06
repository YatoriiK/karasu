import { create } from "zustand";
import { api, ApiError } from "../lib/api";
import { launchSpotify, openExternal, wakeSpotify } from "../lib/tauri";
import type { ConnectState, SpotifyDevice } from "../lib/types";

type ConnectStore = {
  ready: boolean;
  state: ConnectState | null;
  at: number;
  devices: SpotifyDevice[];
  error: string | null;
  missingScopes: string[];
};

export const useConnect = create<ConnectStore>(() => ({
  ready: false,
  state: null,
  at: 0,
  devices: [],
  error: null,
  missingScopes: [],
}));

let timer: number | null = null;
let listeners: ((s: ConnectState) => void)[] = [];

export function onConnectState(fn: (s: ConnectState) => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export async function pollConnect() {
  try {
    const state = await api.connectState();
    useConnect.setState({ state, at: performance.now(), error: null });
    listeners.forEach((l) => l(state));
  } catch (error) {
    useConnect.setState({ error: error instanceof ApiError ? error.message : "Spotify is unreachable" });
  }
}

export function startConnectPolling() {
  if (timer !== null) return;
  void pollConnect();
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void pollConnect();
  }, 2500);
}

export function stopConnectPolling() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

export async function loadDevices() {
  try {
    const [{ devices }, status] = await Promise.all([api.connectDevices(), api.spotifyStatus()]);
    useConnect.setState({ devices, missingScopes: status.missing_scopes, error: null });
    return devices;
  } catch (error) {
    const status = await api.spotifyStatus().catch(() => null);
    useConnect.setState({
      devices: [],
      missingScopes: status?.missing_scopes ?? [],
      error: error instanceof ApiError ? error.message : "Spotify is unreachable",
    });
    return [];
  }
}

export function connectTime(): number {
  const { state, at } = useConnect.getState();
  if (!state?.active) return 0;
  const base = (state.progress_ms ?? 0) / 1000;
  const duration = (state.track?.duration_ms ?? 0) / 1000;
  const now = state.is_playing ? base + (performance.now() - at) / 1000 : base;
  return duration ? Math.min(now, duration) : now;
}

export function connectDuration(): number {
  const { state } = useConnect.getState();
  return (state?.track?.duration_ms ?? 0) / 1000;
}

export function pickDevice(devices: SpotifyDevice[]) {
  return devices.find((d) => d.is_active) ?? devices.find((d) => (d.type || "").toLowerCase() === "computer") ?? devices[0] ?? null;
}

let starting: Promise<SpotifyDevice | null> | null = null;

export function ensureDevice(): Promise<SpotifyDevice | null> {
  if (starting) return starting;
  starting = (async () => {
    let device = pickDevice(await loadDevices());
    if (device) return device;
    const launched = await launchSpotify();
    if (!launched) await openExternal("spotify:");
    for (let i = 0; i < 24 && !device; i++) {
      await new Promise((r) => window.setTimeout(r, 1000));
      device = pickDevice(await loadDevices());
    }
    return device;
  })().finally(() => {
    window.setTimeout(() => (starting = null), 500);
  });
  return starting;
}

// Spotify that sat idle only listens again after play is pressed inside it, so press it through Windows.
export async function wakeConnect(): Promise<SpotifyDevice | null> {
  const device = await ensureDevice();
  if (device && (await wakeSpotify())) await new Promise((r) => window.setTimeout(r, 1200));
  return device;
}
