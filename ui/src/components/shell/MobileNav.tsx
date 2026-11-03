import { useEffect, useState } from "react";
import { AnimatePresence, motion, useTransform } from "motion/react";
import { NavLink, useLocation } from "react-router";
import { BarChart3, Compass, History, LayoutDashboard as Home, Library, ListMusic, MoreHorizontal, Newspaper, Settings2, SkipForward, Telescope, UserRound, X } from "lucide-react";
import { useSharedPlayback } from "../../hooks/usePlayback";
import { currentTrack, usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { AlbumArt } from "../music/AlbumArt";
import { LikeButton } from "../music/LikeButton";
import { IconButton } from "../ui/Button";
import { cn } from "../ui/cn";
import { PlayButton } from "../player/PlayerBar";

const TABS = [
  { to: "/", label: "Desk", icon: Home },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/explore", label: "Explore", icon: Telescope },
  { to: "/library", label: "Library", icon: Library },
];

const MORE = [
  { to: "/feed", label: "Feed", icon: Newspaper },
  { to: "/playlists", label: "Playlists", icon: ListMusic },
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/stats", label: "Statistics", icon: BarChart3 },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

export function MiniPlayer() {
  const track = usePlayer(currentTrack);
  const next = usePlayer((s) => s.next);
  const set = useUi((s) => s.set);
  const { time, duration } = useSharedPlayback();
  const width = useTransform(() => `${Math.min(100, (time.get() / Math.max(duration.get(), 0.001)) * 100)}%`);
  if (!track) return null;
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="glass relative z-30 mx-2 mb-1.5 overflow-hidden rounded-xl md:hidden"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--art-glow) 26%, transparent), transparent 70%)" }}
      />
      <div className="relative flex h-14 items-center gap-3 pl-2 pr-1.5">
        <button onClick={() => set({ nowPlaying: true })} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Open Now Playing">
          <AlbumArt art={track.art} seed={track.id} size={40} className="h-10 w-10" rounded="rounded-md" />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-fg-0">{track.title}</div>
            <div className="truncate text-xs text-fg-2">{track.artist.name}</div>
          </div>
        </button>
        <LikeButton track={track} size={18} className="shrink-0" />
        <PlayButton size={36} />
        <IconButton label="Next" size="sm" round onClick={() => next()}>
          <SkipForward size={17} fill="currentColor" />
        </IconButton>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-fg-0/10">
        <motion.div className="h-full bg-accent" style={{ width }} />
      </div>
    </motion.div>
  );
}

export function MobileTabs() {
  const location = useLocation();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [location.pathname]);
  const moreActive = MORE.some((m) => isActive(location.pathname, m.to));
  return (
    <>
      <nav className="glass-flat relative z-40 grid h-14 shrink-0 grid-cols-5 border-t border-line md:hidden" aria-label="Main">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active = isActive(location.pathname, to);
          return (
            <NavLink key={to} to={to} className={cn("relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors", active ? "text-fg-0" : "text-fg-3")}>
              {active && <motion.span layoutId="tab-dot" className="absolute top-0 h-[2px] w-8 rounded-b-full bg-accent" />}
              <Icon size={20} strokeWidth={active ? 2.3 : 1.9} />
              {label}
            </NavLink>
          );
        })}
        <button
          onClick={() => setMore(true)}
          className={cn("relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors", moreActive ? "text-fg-0" : "text-fg-3")}
        >
          {moreActive && <motion.span layoutId="tab-dot" className="absolute top-0 h-[2px] w-8 rounded-b-full bg-accent" />}
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>
      <AnimatePresence>
        {more && (
          <>
            <motion.div
              className="fixed inset-0 z-[80] bg-[var(--scrim)] backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMore(false)}
            />
            <motion.div
              role="dialog"
              aria-label="More"
              className="fixed inset-x-0 bottom-0 z-[81] rounded-t-3xl bg-bg-2 px-4 pb-6 pt-3 elevated md:hidden"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-fg-0/20" />
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-fg-1">More</span>
                <IconButton label="Close" size="sm" round onClick={() => setMore(false)}>
                  <X size={16} />
                </IconButton>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {MORE.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-[13px] font-semibold transition-colors",
                      isActive(location.pathname, to) ? "bg-accent-soft text-accent" : "bg-bg-3 text-fg-1 hover:bg-bg-4",
                    )}
                  >
                    <Icon size={22} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
