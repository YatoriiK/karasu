import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { launchSpotify } from "../lib/tauri";
import { startConnectPolling, useConnect } from "../store/connect";
import { usePlayer } from "../store/player";
import { usePrefs } from "../store/prefs";

export async function checkSpotify() {
  const status = await api.spotifyStatus().catch(() => null);
  const ready = !!status?.logged_in && !status.missing_scopes.length;
  useConnect.setState({ ready, missingScopes: status?.missing_scopes ?? [] });
  return { status, ready };
}

export function useSpotifyBackground() {
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { ready } = await checkSpotify();
      if (!alive || !ready) return;
      const prefs = usePrefs.getState();
      const player = usePlayer.getState();
      if (prefs.fullSongs && player.source !== "spotify" && !player.playing) usePlayer.setState({ source: "spotify" });
      if (usePlayer.getState().source === "spotify") startConnectPolling();
      if (prefs.launchSpotify) void launchSpotify();
    })();
    return () => {
      alive = false;
    };
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
    if (ready && usePrefs.getState().fullSongs) {
      usePlayer.setState({ source: "spotify" });
      startConnectPolling();
    }
    if (ready && usePrefs.getState().launchSpotify) void launchSpotify();
    toast(s.login_error ? "Spotify sign-in failed" : ready ? "Spotify connected — full songs are on" : "Spotify connected", {
      description: s.login_error ?? undefined,
    });
    onDone?.();
  }, 1500);
}
