import { IN_TAURI } from "./api";

type TauriWindow = {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
};

let cached: Promise<TauriWindow | null> | null = null;

export function appWindow(): Promise<TauriWindow | null> {
  if (!IN_TAURI) return Promise.resolve(null);
  if (!cached) {
    cached = import("@tauri-apps/api/window")
      .then((mod) => mod.getCurrentWindow() as unknown as TauriWindow)
      .catch(() => null);
  }
  return cached;
}

export async function revealWindow() {
  const win = await appWindow();
  if (win) {
    await win.show();
    await win.setFocus();
  }
}

export async function launchSpotify(): Promise<boolean> {
  if (!IN_TAURI) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("launch_spotify");
  } catch {
    return false;
  }
}

export async function wakeSpotify(): Promise<boolean> {
  if (!IN_TAURI) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("wake_spotify");
  } catch {
    return false;
  }
}

export type SpotifyApp = "shown" | "hidden" | "closed";

export async function spotifyApp(): Promise<SpotifyApp | null> {
  if (!IN_TAURI) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SpotifyApp>("spotify_window");
  } catch {
    return null;
  }
}

export async function showSpotifyApp(show: boolean): Promise<boolean> {
  if (!IN_TAURI) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>(show ? "show_spotify" : "hide_spotify");
  } catch {
    return false;
  }
}

export async function openExternal(url: string) {
  if (IN_TAURI) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:opener|open_url", { url });
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener");
}
