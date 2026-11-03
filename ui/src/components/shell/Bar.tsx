import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Minus, Pause, Pencil, Play, Plus, Search, SkipBack, SkipForward, Square, X } from "lucide-react";
import { IN_TAURI } from "../../lib/api";
import { appWindow } from "../../lib/tauri";
import { useDesk } from "../../desk/store";
import { currentTrack, usePlayer } from "../../store/player";
import { useConnect } from "../../store/connect";
import { useUi } from "../../store/ui";
import { Skin } from "../../theme/skins";
import { Logo } from "../ui/states";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";
import { JobsIndicator } from "./Jobs";
import { reconnectSpotify } from "../../hooks/useSpotifyBackground";
import { useFx } from "../../theme/look";

function Clock() {
  const [now, setNow] = useState(() => new Date());
  const h24 = useFx("clock24");
  const showDate = useFx("clockDate");
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {showDate && (
        <>
          {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          <span className="mx-1.5 text-fg-3">·</span>
        </>
      )}
      {now.toLocaleTimeString(undefined, { hour: h24 ? "2-digit" : "numeric", minute: "2-digit", hour12: !h24 })}
    </span>
  );
}

function Transport() {
  const playing = usePlayer((s) => s.playing);
  const has = usePlayer((s) => s.index >= 0);
  const { toggle, next, prev } = usePlayer.getState();
  const btn = "grid h-7 w-7 place-items-center rounded-pill text-fg-2 transition-colors hover:text-fg-0 disabled:opacity-35";
  return (
    <div className="flex items-center">
      <button aria-label="Previous" className={btn} onClick={prev} disabled={!has}>
        <Skin slot="player.prev" size={13}>
          <SkipBack size={13} fill="currentColor" />
        </Skin>
      </button>
      <button aria-label={playing ? "Pause" : "Play"} className={btn} onClick={toggle} disabled={!has}>
        {playing ? (
          <Skin slot="player.pause" size={14}>
            <Pause size={14} fill="currentColor" strokeWidth={0} />
          </Skin>
        ) : (
          <Skin slot="player.play" size={14}>
            <Play size={14} fill="currentColor" strokeWidth={0} />
          </Skin>
        )}
      </button>
      <button aria-label="Next" className={btn} onClick={() => next()} disabled={!has}>
        <Skin slot="player.next" size={13}>
          <SkipForward size={13} fill="currentColor" />
        </Skin>
      </button>
    </div>
  );
}

function Desks() {
  const layouts = useDesk((s) => s.layouts);
  const active = useDesk((s) => s.activeId);
  const navigate = useNavigate();
  if (!layouts.length) return null;
  return (
    <div className="glass flex h-9 items-center gap-1.5 rounded-pill px-3" role="tablist" aria-label="Desks">
      {layouts.map((l) => (
        <Tooltip key={l.id} label={l.name}>
          <button
            role="tab"
            aria-selected={l.id === active}
            aria-label={l.name}
            onClick={() => {
              useDesk.getState().setActive(l.id);
              navigate("/");
            }}
            className={cn("h-3 transition-all duration-300", l.id === active ? "w-12 bg-fg-0" : "w-5 bg-fg-0/30 hover:bg-fg-0/60")}
            style={{ borderRadius: "calc(3px * var(--round))" }}
          />
        </Tooltip>
      ))}
      <Tooltip label="New desk">
        <button
          aria-label="New desk"
          onClick={async () => {
            const d = useDesk.getState();
            const current = d.layouts.find((l) => l.id === d.activeId);
            await d.createLayout(`Desk ${d.layouts.length + 1}`, {
              canvas: current?.data.canvas ?? { w: 1280, h: 620 },
              grid: 8,
              wallpaper: current?.data.wallpaper ?? null,
              items: [],
            });
            navigate("/");
            useDesk.getState().setEditing(true);
          }}
          className="ml-0.5 grid h-5 w-5 place-items-center text-fg-3 transition-colors hover:text-fg-0"
        >
          <Plus size={13} />
        </button>
      </Tooltip>
    </div>
  );
}

function WindowControls() {
  if (!IN_TAURI) return null;
  const act = (fn: "minimize" | "toggleMaximize" | "close") => appWindow().then((w) => w?.[fn]());
  const btn = "grid h-9 w-9 place-items-center text-fg-2 transition-colors hover:text-fg-0";
  return (
    <div className="glass flex h-9 items-center rounded-pill px-1">
      <button aria-label="Minimize" className={btn} onClick={() => act("minimize")}>
        <Minus size={14} />
      </button>
      <button aria-label="Maximize" className={btn} onClick={() => act("toggleMaximize")}>
        <Square size={11} />
      </button>
      <button aria-label="Close" className={cn(btn, "hover:text-bad")} onClick={() => act("close")}>
        <X size={15} />
      </button>
    </div>
  );
}

export function Bar() {
  const navigate = useNavigate();
  const track = usePlayer(currentTrack);
  const source = usePlayer((s) => s.source);
  const device = useConnect((s) => s.state?.device?.name);
  const needsReconnect = useConnect((s) => s.missingScopes.length > 0);
  return (
    <header className="relative z-40 flex h-12 shrink-0 select-none items-center gap-2 px-2 pt-2" data-tauri-drag-region>
      <div className="glass flex h-9 min-w-0 items-center gap-2 rounded-pill pl-1.5 pr-2">
        <button onClick={() => navigate("/")} className="flex items-center gap-2" aria-label="Karasu desk">
          <Skin slot="bar.logo" size={24}>
            <Logo size={24} />
          </Skin>
          <span className="hidden font-display text-[15px] font-bold tracking-tight text-fg-0 sm:inline">karasu</span>
          <span className="hidden text-[12px] text-fg-3 lg:inline">烏</span>
        </button>
        <span className="mx-1 h-4 w-px bg-line-strong" />
        <Transport />
        {track && (
          <span className="hidden max-w-[220px] truncate font-mono text-[11.5px] text-fg-2 xl:inline">
            {track.title} — {track.artist.name}
          </span>
        )}
      </div>
      <JobsIndicator />
      <div className="flex-1" data-tauri-drag-region />
      <div className="absolute left-1/2 top-2 hidden -translate-x-1/2 md:block">
        <Desks />
      </div>
      <div className="glass flex h-9 items-center gap-1 rounded-pill pl-1 pr-3 font-mono text-[12px] text-fg-1">
        <Tooltip label="Search (Ctrl K)">
          <button aria-label="Search" onClick={() => useUi.getState().set({ searchOpen: true })} className="grid h-7 w-7 place-items-center rounded-pill text-fg-2 hover:text-fg-0">
            <Skin slot="bar.search" size={14}>
              <Search size={14} />
            </Skin>
          </button>
        </Tooltip>
        <Tooltip label="Arrange the desk">
          <button
            aria-label="Arrange the desk"
            onClick={() => {
              navigate("/");
              useDesk.getState().setEditing(true);
            }}
            className="grid h-7 w-7 place-items-center rounded-pill text-fg-2 hover:text-fg-0"
          >
            <Skin slot="bar.edit" size={14}>
              <Pencil size={13} />
            </Skin>
          </button>
        </Tooltip>
        <span className="mx-1 h-4 w-px bg-line-strong" />
        {needsReconnect && (
          <Tooltip label="Spotify needs one more sign-in for full songs, playlists and likes">
            <button onClick={() => void reconnectSpotify()} className="mr-1 rounded-pill bg-fg-0 px-2.5 py-1 text-[11px] font-bold text-bg-0 hover:opacity-90">
              connect spotify
            </button>
          </Tooltip>
        )}
        {source === "spotify" && device && <span className="hidden max-w-[140px] truncate text-fg-2 lg:inline">♪ {device} ·</span>}
        <Clock />
      </div>
      <WindowControls />
    </header>
  );
}
