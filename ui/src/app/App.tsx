import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { api, ApiError, IN_TAURI } from "../lib/api";
import { engineInfo, installEngine, onInstall, type EngineInfo, type InstallProgress } from "../lib/engine";
import { connectEvents, onEvent } from "../lib/events";
import { page } from "../lib/motion";
import { revealWindow } from "../lib/tauri";
import { usePalette, useAmbientVars } from "../hooks/useAmbient";
import { usePrefsEffect } from "../hooks/usePrefsEffect";
import { currentTrack, usePlayer, wirePlayerEngine } from "../store/player";
import { fxOf, useLook } from "../theme/look";
import { Bar } from "../components/shell/Bar";
import { Dock } from "../components/shell/Dock";
import { PageWindow } from "../components/shell/PageWindow";
import { Wallpaper } from "../components/shell/Wallpaper";
import { Ambient } from "../components/shell/Ambient";
import { SceneLayer } from "../components/shell/SceneLayer";
import { CursorLayer } from "../components/shell/Cursor";
import { InkFilters } from "../theme/skins";
import { Desk } from "../desk/Desk";
import { useDesk } from "../desk/store";
import { PlayerBar } from "../components/player/PlayerBar";
import { NowPlaying } from "../components/player/NowPlaying";
import { QueuePanel } from "../components/player/QueuePanel";
import { SearchPalette } from "../components/search/SearchPalette";
import { AddToPlaylist } from "../components/music/AddToPlaylist";
import { Splash } from "./Splash";
import { ChooseHome, Installing } from "./EngineSetup";
import { HomePage } from "../pages/Home";
import { NotFound } from "../pages/NotFound";
import { useShortcuts } from "../hooks/useShortcuts";
import { useSpotifyBackground } from "../hooks/useSpotifyBackground";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { ShortcutsDialog } from "../components/shell/ShortcutsDialog";
import { MiniPlayer, MobileTabs } from "../components/shell/MobileNav";
import { ScrollContext } from "./scroll";
import { Skeleton } from "../components/ui/states";
import { cn } from "../components/ui/cn";

const SearchPage = lazy(() => import("../pages/Search").then((m) => ({ default: m.SearchPage })));
const PlaylistsPage = lazy(() => import("../pages/Playlists").then((m) => ({ default: m.PlaylistsPage })));
const PlaylistPage = lazy(() => import("../pages/Playlist").then((m) => ({ default: m.PlaylistPage })));
const LibraryPage = lazy(() => import("../pages/Library").then((m) => ({ default: m.LibraryPage })));
const SettingsPage = lazy(() => import("../pages/Settings").then((m) => ({ default: m.SettingsPage })));
const TrackPage = lazy(() => import("../pages/Track").then((m) => ({ default: m.TrackPage })));
const ArtistPage = lazy(() => import("../pages/Artist").then((m) => ({ default: m.ArtistPage })));
const AlbumPage = lazy(() => import("../pages/Album").then((m) => ({ default: m.AlbumPage })));
const DiscoverPage = lazy(() => import("../pages/Discover").then((m) => ({ default: m.DiscoverPage })));
const StudioPage = lazy(() => import("../pages/Studio").then((m) => ({ default: m.StudioPage })));
const ExplorePage = lazy(() => import("../pages/Explore").then((m) => ({ default: m.ExplorePage })));
const GenrePage = lazy(() => import("../pages/Genre").then((m) => ({ default: m.GenrePage })));
const HistoryPage = lazy(() => import("../pages/History").then((m) => ({ default: m.HistoryPage })));
const StatsPage = lazy(() => import("../pages/Stats").then((m) => ({ default: m.StatsPage })));
const ProfilePage = lazy(() => import("../pages/Profile").then((m) => ({ default: m.ProfilePage })));
const WelcomePage = lazy(() => import("../pages/Welcome").then((m) => ({ default: m.WelcomePage })));

let firstRunChecked = false;

function useFirstRun() {
  const navigate = useNavigate();
  useEffect(() => {
    if (firstRunChecked) return;
    firstRunChecked = true;
    api
      .setup()
      .then((setup) => {
        if (setup.needed && window.location.hash.replace(/^#/, "").split("?")[0] !== "/welcome") navigate("/welcome", { replace: true });
      })
      .catch(() => undefined);
  }, [navigate]);
}

function PageFallback() {
  return (
    <div className="pt-6" aria-busy="true">
      <Skeleton className="h-10 w-72 rounded-lg" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-10 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

type SetupPhase = "check" | "choose" | "install" | "start";

function useEngineSetup() {
  const [phase, setPhase] = useState<SetupPhase>(IN_TAURI ? "check" : "start");
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const install = (next: EngineInfo | null) => {
    if (next) setInfo(next);
    setError(null);
    setProgress(null);
    setPhase("install");
    installEngine().catch((e) => setError(String(e)));
  };

  useEffect(() => {
    if (!IN_TAURI) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    onInstall((p) => {
      if (!alive) return;
      if (p.stage === "done") setPhase("start");
      else if (p.stage === "error") setError(p.detail);
      else setProgress(p);
    })
      .then((stop) => (alive ? (unlisten = stop) : stop()))
      .catch(() => undefined);
    engineInfo().then((next) => {
      if (!alive) return;
      setInfo(next);
      if (!next || next.ready) setPhase("start");
      else if (next.installing) setPhase("install");
      else if (!next.home) setPhase("choose");
      else if (next.error) {
        setError(next.error);
        setPhase("install");
      } else install(next);
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return { phase, info, progress, error, install };
}

function useEngineReady(active: boolean, logs: string | null) {
  const [state, setState] = useState<{ ready: boolean; status: string; error: string | null }>({
    ready: false,
    status: active ? "Starting the engine…" : "Checking the engine…",
    error: null,
  });
  useEffect(() => {
    if (!active) return;
    setState((s) => ({ ...s, status: "Starting the engine…" }));
    let alive = true;
    const started = Date.now();
    const tick = async () => {
      try {
        const health = await api.health();
        if (!alive) return;
        if (health.ok) {
          setState({ ready: true, status: "Ready", error: null });
          return;
        }
        setState((s) => ({ ...s, status: "Loading your library…" }));
      } catch (error) {
        if (!alive) return;
        const waited = (Date.now() - started) / 1000;
        if (waited > 45) {
          setState({
            ready: false,
            status: "The engine didn't start",
            error:
              error instanceof ApiError
                ? `${error.message}\n\nCheck ${logs ? `${logs}\\backend.log` : "backend.log in the data\\logs folder of Karasu's folder"}, then restart Karasu.`
                : String(error),
          });
        } else if (waited > 6) {
          setState((s) => ({ ...s, status: "Warming up the audio model…" }));
        }
      }
      if (alive) setTimeout(tick, 500);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [active, logs]);
  return state;
}

function Shell() {
  const location = useLocation();
  const qc = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const track = usePlayer(currentTrack);
  const palette = usePalette(track);
  const onDesk = location.pathname === "/";
  const dockRight = useLook((s) => fxOf(s.look).dock === "right");
  useAmbientVars(palette);
  useShortcuts();
  useSpotifyBackground();
  useFirstRun();
  useGlobalShortcuts();

  useEffect(() => {
    connectEvents();
    void useDesk.getState().load().catch(() => undefined);
    return onEvent((event) => {
      if (event.type === "job" && event.finished) {
        if (event.kind === "backfill" || event.kind === "snapshot" || event.kind === "setup") {
          qc.invalidateQueries({ queryKey: ["home"] });
          qc.invalidateQueries({ queryKey: ["library"] });
          qc.invalidateQueries({ queryKey: ["health"] });
          qc.invalidateQueries({ queryKey: ["fetch"] });
        }
        if (event.kind === "setup") {
          qc.invalidateQueries({ queryKey: ["setup"] });
          qc.invalidateQueries({ queryKey: ["daily"] });
          qc.invalidateQueries({ queryKey: ["explore"] });
        }
      }
    });
  }, [qc]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    if (!onDesk) useDesk.getState().setEditing(false);
  }, [location.pathname, onDesk]);

  return (
    <div className="grain relative flex h-full flex-col overflow-hidden">
      <InkFilters />
      <Wallpaper />
      <SceneLayer />
      <Ambient />
      <Bar />
      <div className={cn("relative z-10 flex min-h-0 flex-1 gap-2 px-2 pb-2 pt-2", dockRight && "flex-row-reverse")}>
        <Dock />
        <main className="relative min-w-0 flex-1">
          <AnimatePresence mode="popLayout" initial={false}>
            {onDesk ? (
              <motion.div key="desk" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Desk />
              </motion.div>
            ) : (
              <motion.div
                key="window"
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 0.985, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.985, y: 10 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
              >
                <PageWindow scroller={scroller}>
                  <ScrollContext.Provider value={scroller}>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={location.pathname + location.search}
                        variants={page}
                        initial="initial"
                        animate="enter"
                        exit="exit"
                        className="mx-auto w-full max-w-[1480px] px-6 pb-16 pt-6 md:px-8"
                      >
                        <Suspense fallback={<PageFallback />}>
                          <Routes location={location}>
                            <Route path="/feed" element={<HomePage />} />
                            <Route path="/discover" element={<DiscoverPage />} />
                            <Route path="/discover/:mode" element={<DiscoverPage />} />
                            <Route path="/explore" element={<ExplorePage />} />
                            <Route path="/explore/genre/:id" element={<GenrePage />} />
                            <Route path="/playlists" element={<PlaylistsPage />} />
                            <Route path="/studio" element={<StudioPage />} />
                            <Route path="/playlist/:id" element={<PlaylistPage />} />
                            <Route path="/library" element={<LibraryPage />} />
                            <Route path="/history" element={<HistoryPage />} />
                            <Route path="/stats" element={<StatsPage />} />
                            <Route path="/profile" element={<ProfilePage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                            <Route path="/welcome" element={<WelcomePage />} />
                            <Route path="/search" element={<SearchPage />} />
                            <Route path="/track/:id" element={<TrackPage />} />
                            <Route path="/artist/:id" element={<ArtistPage />} />
                            <Route path="/album/:id" element={<AlbumPage />} />
                            <Route path="*" element={<NotFound />} />
                          </Routes>
                        </Suspense>
                      </motion.div>
                    </AnimatePresence>
                  </ScrollContext.Provider>
                </PageWindow>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      <PlayerBar />
      <MiniPlayer />
      <MobileTabs />
      <NowPlaying />
      <QueuePanel />
      <SearchPalette />
      <AddToPlaylist />
      <ShortcutsDialog />
      <div className="screen-fx" aria-hidden />
      <CursorLayer />
    </div>
  );
}

export function App() {
  usePrefsEffect();
  const setup = useEngineSetup();
  const engine = useEngineReady(setup.phase === "start", setup.info?.log ?? null);
  const scheme = useLook((s) => s.look.scheme);

  useEffect(() => {
    wirePlayerEngine();
    requestAnimationFrame(() => revealWindow());
  }, []);

  return (
    <>
      {engine.ready ? (
        <Shell />
      ) : (
        <Splash status={engine.status} error={engine.error}>
          {setup.phase === "choose" && setup.info ? (
            <ChooseHome info={setup.info} onInstall={setup.install} />
          ) : setup.phase === "install" ? (
            <Installing progress={setup.progress} error={setup.error} info={setup.info} onRetry={() => setup.install(null)} />
          ) : null}
        </Splash>
      )}
      <Toaster
        theme={scheme}
        position="bottom-center"
        offset={104}
        gap={8}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-md !bg-bg-3 !text-fg-0 !shadow-[inset_0_0_0_1px_var(--line-strong),0_18px_50px_-18px_rgb(0_0_0/0.7)] !border-0 !font-mono !text-[12.5px]",
            description: "!text-fg-2",
            actionButton: "!bg-fg-0 !text-bg-0 !font-semibold !rounded-sm",
          },
        }}
      />
    </>
  );
}
