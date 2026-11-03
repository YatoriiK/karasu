import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { launchSpotify } from "../lib/tauri";
import { startConnectPolling, useConnect } from "../store/connect";
import { usePlayer } from "../store/player";
import { usePrefs } from "../store/prefs";

// Every way of connecting Spotify ends up here, so "Full songs" is on as soon as Spotify is,
// not only after you flick the switch off and on again.
export function applyFullSongs() {
  if (!useConnect.getState().ready || !usePrefs.getState().fullSongs) return;
  const player = usePlayer.getState();
  if (player.source !== "spotify") {
    if (player.playing) player.setSource("spotify");
    else usePlayer.setState({ source: "spotify" });
  }
  startConnectPolling();
}

export async function checkSpotify() {
  const was = useConnect.getState().ready;
  const status = await api.spotifyStatus().catch(() => null);
  const ready = !!status?.logged_in && !status.missing_scopes.length;
  useConnect.setState({ ready, missingScopes: status?.missing_scopes ?? [] });
  if (ready && !was) {
    applyFullSongs();
    if (usePlayer.getState().source === "spotify") startConnectPolling();
    if (usePrefs.getState().launchSpotify) void launchSpotify();
  }
  return { status, ready };
}

export function useSpotifyBackground() {
  useEffect(() => {
    void checkSpotify();
  }, []);
}

export async function reconnectSpotify(onDone?: () => void) {
  try {
    await api.spotifyLogin();
  } catch (error) {
    toast("Couldn't start Spotify sign-in", { description: (error as Error).message });
    return;
  }
  toast("Finish signing in in your browser", { description: "Karasu asks for playback, library and playlist access." });
  const poll = window.setInterval(async () => {
    const s = await api.spotifyStatus().catch(() => null);
    if (!s || s.login_running) return;
    window.clearInterval(poll);
    const { ready } = await checkSpotify();
    if (ready) applyFullSongs();
    toast(s.login_error ? "Spotify sign-in failed" : ready ? "Spotify connected. Full songs are on" : "Spotify connected", {
      description: s.login_error ?? undefined,
    });
    onDone?.();
  }, 1500);
}
