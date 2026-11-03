import { IN_TAURI } from "./api";

export type EngineInfo = {
  home: string | null;
  default_home: string;
  dev: boolean;
  ready: boolean;
  installing: boolean;
  error: string | null;
  gpu: boolean;
  free_bytes: number | null;
  needs_bytes: number;
  log: string | null;
};

export type InstallProgress = {
  stage: "step" | "line" | "done" | "error";
  step: number;
  steps: number;
  label: string;
  detail: string;
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export async function engineInfo(): Promise<EngineInfo | null> {
  if (!IN_TAURI) return null;
  try {
    return await invoke<EngineInfo>("engine_info");
  } catch {
    return null;
  }
}

export const setEngineHome = (path: string) => invoke<EngineInfo>("set_engine_home", { path });

export const installEngine = () => invoke<void>("install_engine");

export async function onInstall(handler: (progress: InstallProgress) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<InstallProgress>("engine-install", (event) => handler(event.payload));
}

export async function pickFolder(defaultPath: string): Promise<string | null> {
  const picked = await invoke<string | string[] | null>("plugin:dialog|open", {
    options: { directory: true, multiple: false, defaultPath, title: "Where should Karasu keep its engine and library?" },
  });
  return Array.isArray(picked) ? (picked[0] ?? null) : picked;
}

export function gigabytes(bytes: number | null | undefined) {
  if (bytes == null) return "?";
  const gb = bytes / 1024 ** 3;
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
}
