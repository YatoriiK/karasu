import type { DeskData, Layout } from "../desk/types";
import type {
  Artist,
  Asset,
  SetupPath,
  SetupState,
  SpotifyUser,
  FetchInfo,
  Compare,
  Daily,
  SongOfDay,
  ExploreFilters,
  ExploreOverview,
  GenrePage,
  HistoryItem,
  Listeners,
  LiveSearch,
  Taste,
  UserProfile,
  Stats,
  ConnectState,
  DiscoverOptions,
  DiscoverResult,
  GenerateParams,
  GenerateResult,
  SpotifyDevice,
  EngineSetting,
  Health,
  Home,
  Job,
  Lyrics,
  Palette,
  PlaylistDetail,
  PlaylistSummary,
  SearchResult,
  SearchSuggest,
  Track,
} from "./types";

export const IN_TAURI =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost");

export const API_BASE = IN_TAURI ? "http://127.0.0.1:8765" : "";

export function media(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

function videoSize(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (size: { w: number; h: number } | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(size);
    };
    const timer = window.setTimeout(() => done(null), 6000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(video.videoWidth ? { w: video.videoWidth, h: video.videoHeight } : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "Can't reach the Karasu engine.");
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = typeof data.detail === "string" ? data.detail : message;
    } catch {
      /* not json */
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

async function failure(response: Response) {
  let message = response.statusText;
  try {
    const data = await response.json();
    message = typeof data.detail === "string" ? data.detail : message;
  } catch {
    /* not json */
  }
  return new ApiError(response.status, message);
}

export type DeskPreview = { token: string; name: string; widgets: number; pictures: number; bytes: number; css: boolean };

export const get = <T,>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal);
export const post = <T,>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const put = <T,>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {});
export const del = <T,>(path: string) => request<T>("DELETE", path);

const q = (value: string) => encodeURIComponent(value);

export const api = {
  health: (signal?: AbortSignal) => get<Health>("/api/health", signal),
  home: () => get<Home>("/api/home"),
  daily: () => get<Daily>("/api/daily"),
  anotherSong: () => post<SongOfDay | null>("/api/daily/song/another"),
  suggest: (text: string, signal?: AbortSignal) => get<SearchSuggest>(`/api/search/suggest?q=${q(text)}`, signal),
  live: (text: string, remote: boolean, signal?: AbortSignal) => get<LiveSearch>(`/api/search/live?q=${q(text)}&remote=${remote ? 1 : 0}`, signal),
  search: (text: string) => get<SearchResult>(`/api/search?q=${q(text)}`),
  vibe: (text: string, limit = 30) => post<{ results: Track[] }>("/api/search/vibe", { q: text, limit }),
  track: (id: string) => get<{ track: Track; similar: Track[] }>(`/api/tracks/${q(id)}`),
  trackLinks: (id: string) => get<{ spotify: string | null; deezer: string | null }>(`/api/tracks/${q(id)}/links`),
  trackPalette: (id: string) => get<Palette | Record<string, never>>(`/api/tracks/${q(id)}/palette`),
  lyrics: (id: string) => get<Lyrics>(`/api/lyrics/${q(id)}`),
  library: (kind: string, offset = 0, limit = 60) =>
    get<{ kind: string; total: number; offset: number; items: Track[] }>(
      `/api/library/${kind}?offset=${offset}&limit=${limit}`,
    ),
  liked: (ids: string[]) => get<Record<string, boolean>>(`/api/liked?ids=${ids.map(encodeURIComponent).join(",")}`),
  feedback: (id: string, kind: "up" | "down" | "clear" | "never_artist") =>
    post<{ ok: boolean; track: Track | null }>("/api/feedback", { id, kind }),
  playlists: () => get<PlaylistSummary[]>("/api/playlists"),
  playlist: (id: string) => get<PlaylistDetail>(`/api/playlists/${q(id)}`),
  createPlaylist: (body: { name: string; description?: string; track_ids: string[]; params?: unknown }) =>
    post<PlaylistDetail>("/api/playlists", body),
  updatePlaylist: (id: string, body: { name: string; description?: string; track_ids: string[] }) =>
    put<PlaylistDetail>(`/api/playlists/${q(id)}`, body),
  deletePlaylist: (id: string) => del<{ ok: boolean }>(`/api/playlists/${q(id)}`),
  pushPlaylist: (id: string) =>
    post<{ ok: boolean; sp_id: string; matched: number; total: number }>(`/api/playlists/${q(id)}/spotify`),
  jobs: () => get<{ running: Job[]; recent: Job[] }>("/api/jobs"),
  job: (id: string) => get<Job>(`/api/jobs/${q(id)}`),
  cancelJob: (id: string) => post<{ ok: boolean }>(`/api/jobs/${q(id)}/cancel`),
  settings: () => get<EngineSetting[]>("/api/settings"),
  setSetting: (key: string, value: number) => post<{ ok: boolean; value: number }>("/api/settings", { key, value }),
  discoverOptions: () => get<DiscoverOptions>("/api/discover/options"),
  discover: (mode: string, body: { seed?: string | null; novelty?: number; limit?: number; aspect?: string | null; nonce?: number | null }) =>
    post<DiscoverResult>(`/api/discover/${mode}`, body),
  deeper: (mode: string, seed?: string | null) => post<{ job: string; artists: number }>("/api/discover/deeper", { mode, seed }),
  analyze: (id: string) => post<{ job: string; id: string }>(`/api/tracks/${q(id)}/analyze`),
  generate: (body: GenerateParams) => post<GenerateResult>("/api/generate", body),
  regenerate: (draft: string) => post<GenerateResult>(`/api/generate/${draft}/regenerate`),
  replace: (draft: string, index: number, track_ids: string[]) =>
    post<{ track: Track }>(`/api/generate/${draft}/replace`, { index, track_ids }),
  spotifyStatus: () =>
    get<{
      configured: boolean;
      logged_in: boolean;
      missing_scopes: string[];
      login_running: boolean;
      login_error: string | null;
      login_url?: string | null;
      user?: SpotifyUser;
    }>("/api/spotify/status"),
  setup: () => get<SetupState>("/api/setup"),
  setClientId: (client_id: string) => put<SetupState>("/api/setup/spotify", { client_id }),
  setupSync: () => post<{ job: string }>("/api/setup/sync"),
  setupArtists: (text: string, signal?: AbortSignal) => get<Artist[]>(`/api/setup/artists?q=${q(text)}`, signal),
  setupPicks: (artist_ids: number[]) => put<{ job: string }>("/api/setup/picks", { artist_ids }),
  finishSetup: (body: { path?: SetupPath; history_requested?: boolean }) => post<SetupState>("/api/setup/finish", body),
  spotifyLogin: () => post<{ started: boolean }>("/api/spotify/login"),
  connectState: () => get<ConnectState>("/api/player/spotify/state"),
  connectDevices: () => get<{ devices: SpotifyDevice[] }>("/api/player/spotify/devices"),
  connectPlay: (track_ids: string[], offset: number, device_id?: string | null, position_ms?: number | null, context?: string | null, shuffle?: boolean | null) =>
    post<{ ok: boolean; matched: number | null }>("/api/player/spotify/play", { track_ids, offset, device_id, position_ms, context, shuffle }),
  connectCommand: (action: string, value?: unknown, device_id?: string | null) =>
    post<{ ok: boolean }>("/api/player/spotify/command", { action, value, device_id }),
  saveToSpotify: (id: string) => post<{ ok: boolean; sp_id: string }>("/api/library/save", { id }),
  unsaveFromSpotify: (id: string) => post<{ ok: boolean; sp_id: string }>("/api/library/unsave", { id }),
  syncLibrary: () => post<{ job: string | null }>("/api/library/sync"),
  addToPlaylist: (pid: string, track_ids: string[]) => post<{ ok: boolean; added: number }>(`/api/playlists/${q(pid)}/tracks`, { track_ids }),
  removeFromPlaylist: (pid: string, track_ids: string[]) =>
    post<{ ok: boolean; removed: number }>(`/api/playlists/${q(pid)}/tracks/remove`, { track_ids }),
  createSpotifyPlaylist: (name: string, track_ids: string[], description?: string) =>
    post<{ ok: boolean; id: string; matched: number; total: number }>("/api/spotify/playlists", { name, description, track_ids }),
  explore: () => get<ExploreOverview>("/api/explore"),
  genre: (id: string) => get<GenrePage>(`/api/genres/${q(id)}`),
  refreshGenres: () => post<{ job: string }>("/api/genres/refresh"),
  trending: () => get<Track[]>("/api/explore/trending"),
  exploreQuery: (body: ExploreFilters & { limit?: number; offset?: number }) =>
    post<{ total: number; offset: number; items: Track[] }>("/api/explore/query", body),
  stats: (range: string) => get<Stats>(`/api/stats?range=${range}`),
  taste: () => get<Taste>("/api/profile"),
  exportTaste: () => get<Record<string, unknown>>("/api/profile/export"),
  me: () => get<UserProfile>("/api/me"),
  listeners: (pick: { artist?: string; sp?: string; track?: string; retry?: string }) =>
    get<Listeners>(`/api/listeners?${new URLSearchParams(Object.entries(pick).filter(([, v]) => v) as [string, string][])}`),
  prefetchListeners: (artists: string[]) => post<{ queued: number }>("/api/listeners/prefetch", { artists }),
  listenerMap: () => get<{ enabled: boolean }>("/api/listeners/enabled"),
  setListenerMap: (enabled: boolean) => put<{ enabled: boolean }>("/api/listeners/enabled", { enabled }),
  setKey: (service: "lastfm" | "discogs", value: string) => put<{ lastfm: boolean; discogs: boolean }>(`/api/keys/${service}`, { value }),
  compare: (profile: unknown) => post<Compare>("/api/compare", profile),
  history: (offset = 0, limit = 80) => get<{ total: number; offset: number; items: HistoryItem[] }>(`/api/history?offset=${offset}&limit=${limit}`),
  importHistory: (paths: string[]) => post<{ job: string }>("/api/import/history", { paths }),
  playEvent: (id: string, ms: number) => post<{ ok: boolean }>("/api/player/events", { id, ms }),
  layouts: () => get<{ active: number; layouts: Layout[] }>("/api/layouts"),
  createLayout: (name: string, data?: DeskData) => post<Layout>("/api/layouts", { name, data }),
  saveLayout: (id: number, body: { name?: string; data?: DeskData }) => put<Layout>(`/api/layouts/${id}`, body),
  deleteLayout: (id: number) => del<{ ok: boolean }>(`/api/layouts/${id}`),
  activateLayout: (id: number) => put<{ active: number }>(`/api/layouts/active/${id}`),
  orderLayouts: (ids: number[]) => post<{ ok: boolean }>("/api/layouts/order", { ids }),
  assets: () => get<Asset[]>("/api/assets"),
  deleteAsset: (id: string) => del<{ ok: boolean }>(`/api/assets/${q(id)}`),
  renameAsset: (id: string, name: string) => request<Asset>("PATCH", `/api/assets/${q(id)}`, { name }),
  uploadAsset: async (file: Blob, name: string) => {
    const size = file.type.startsWith("video/") ? await videoSize(file) : null;
    const dims = size ? `&w=${size.w}&h=${size.h}` : "";
    const response = await fetch(`${API_BASE}/api/assets?name=${q(name)}${dims}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const data = await response.json();
        message = typeof data.detail === "string" ? data.detail : message;
      } catch {
        /* not json */
      }
      throw new ApiError(response.status, message);
    }
    return (await response.json()) as Asset;
  },
  exportDesk: async (id: number, look: unknown) => {
    const response = await fetch(`${API_BASE}/api/layouts/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ look }),
    }).catch(() => null);
    if (!response) throw new ApiError(0, "Can't reach the Karasu engine.");
    if (!response.ok) throw await failure(response);
    const named = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(response.headers.get("content-disposition") ?? "");
    const name = named ? decodeURIComponent(named[1] ?? named[2]) : "desk.karasu";
    return { blob: await response.blob(), name };
  },
  previewDesk: async (file: Blob) => {
    const response = await fetch(`${API_BASE}/api/layouts/import`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: file }).catch(
      () => null,
    );
    if (!response) throw new ApiError(0, "Can't reach the Karasu engine.");
    if (!response.ok) throw await failure(response);
    return (await response.json()) as DeskPreview;
  },
  importDesk: (token: string, css: boolean) => post<Layout>(`/api/layouts/import/${q(token)}?css=${css}`),
  fetchInfo: () => get<FetchInfo>("/api/fetch"),
  storage: () =>
    get<{ audio: { files: number; bytes: number }; art: { files: number; bytes: number }; database: number; location: string }>("/api/storage"),
  clearAudioCache: () => post<{ removed: number }>("/api/storage/clear-audio"),
  clearSearchHistory: () => del<{ ok: boolean }>("/api/search/history"),
  resetHistory: () => post<{ removed: number }>("/api/history/reset"),
  exclusions: () => get<{ kind: string; value: string; label: string; created: string }[]>("/api/exclusions"),
  addExclusion: (kind: string, value: string, label?: string) =>
    post<{ ok: boolean }>("/api/exclusions", { kind, value, label }),
  removeExclusion: (kind: string, value: string) => del<{ ok: boolean }>(`/api/exclusions/${q(kind)}/${q(value)}`),
};
