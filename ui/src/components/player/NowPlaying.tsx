import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListMusic, MicVocal, ThumbsDown } from "lucide-react";
import { api } from "../../lib/api";
import { artUrl } from "../../lib/art";
import { EASE } from "../../lib/motion";
import { currentTrack, upcomingTrack, useLiveArt, usePlayer } from "../../store/player";
import { useFx, useTint } from "../../theme/look";
import { useUi } from "../../store/ui";
import { IconButton } from "../ui/Button";
import { cn } from "../ui/cn";
import { AlbumArt } from "../music/AlbumArt";
import { LikeButton } from "../music/LikeButton";
import { ReasonList } from "../music/Reasons";
import { TrackContextMenu } from "../music/TrackMenu";
import { Record } from "../visual/Record";
import { useTrackActions } from "../music/useTrackActions";
import { Seekbar } from "./Seekbar";
import { SourcePill, Transport } from "./PlayerBar";
import { Waveform, type VizStyle } from "../viz/Waveform";
import { playbackNow } from "../../hooks/usePlayback";
import type { Track } from "../../lib/types";

export const lyricsQuery = (id: string) =>
  queryOptions({
    queryKey: ["lyrics", id],
    queryFn: () => api.lyrics(id),
    staleTime: (query) => (query.state.data?.status === "busy" ? 0 : Infinity),
    retry: 0,
  });

function Lyrics({ track }: { track: Track }) {
  const { data, isLoading, isFetching, refetch } = useQuery(lyricsQuery(track.id));
  const queryClient = useQueryClient();
  const upcoming = usePlayer(upcomingTrack);
  const source = usePlayer((s) => s.source);
  const synced = source === "spotify" && data?.synced?.length ? data.synced : null;
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  useEffect(() => {
    if (!synced) return;
    let raf = 0;
    let last = -2;
    const tick = () => {
      const t = playbackNow() + 0.3;
      let i = -1;
      for (let k = 0; k < synced.length && synced[k].t <= t; k++) i = k;
      if (i !== last) {
        last = i;
        setActive(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [synced]);

  useEffect(() => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!el || !line) return;
    el.scrollTo({ top: line.offsetTop - (el.clientHeight - line.offsetHeight) / 2, behavior: placed.current ? "smooth" : "instant" });
    placed.current = true;
  }, [active]);

  useEffect(() => {
    if (data && data.status !== "busy" && upcoming) void queryClient.prefetchQuery(lyricsQuery(upcoming.id));
  }, [data, upcoming, queryClient]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">Lyrics</h3>
        {data?.source && <span className="text-xs text-white/45">via {data.source}</span>}
      </div>
      <div ref={box} className="scroll-area relative -ml-2 min-h-0 flex-1 pl-2 pr-3" style={{ maskImage: "linear-gradient(transparent, #000 8%, #000 88%, transparent)" }}>
        {isLoading ? (
          <div className="space-y-3 py-6">
            <p className="mb-4 text-sm text-white/50">Looking for lyrics…</p>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="skeleton h-6 rounded-md" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
            ))}
          </div>
        ) : data?.status === "busy" ? (
          <div className="py-10">
            <p className="text-lg text-white/75">The lyrics service is busy right now.</p>
            <p className="mt-1 text-sm text-white/50">LRCLIB is a free community project and sometimes needs a moment.</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-4 rounded-pill bg-white/12 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50"
            >
              {isFetching ? "Trying…" : "Try again"}
            </button>
          </div>
        ) : data?.instrumental ? (
          <p className="py-10 text-2xl font-semibold text-white/80">♪ Instrumental</p>
        ) : synced ? (
          <div className="space-y-1 py-[30vh]">
            {synced.map((line, i) => (
              <button
                key={i}
                data-line={i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => usePlayer.getState().seek(line.t)}
                className={cn(
                  "block w-full origin-left rounded-md text-left text-[24px] font-semibold leading-snug transition-[color,opacity,transform] duration-300",
                  i === active ? "scale-[1.02] text-white" : i < active ? "text-white/35" : "text-white/55 hover:text-white/80",
                )}
              >
                {line.text || "♪"}
              </button>
            ))}
          </div>
        ) : data?.plain ? (
          <div className="pt-6">
            {source !== "spotify" && (
              <p className="mb-5 rounded-lg bg-white/8 px-3 py-2 text-xs text-white/65">
                You're hearing a 30-second preview, so lyrics can't follow along. They sync up when Spotify plays the full song.
              </p>
            )}
            <div className="selectable whitespace-pre-line pb-16 text-[22px] font-semibold leading-[1.55] text-white/85">{data.plain}</div>
          </div>
        ) : (
          <p className="py-10 text-lg text-white/60">No lyrics found for this one.</p>
        )}
      </div>
    </div>
  );
}

export function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const lyricsOpen = useUi((s) => s.lyricsOpen);
  const set = useUi((s) => s.set);
  const track = usePlayer(currentTrack);
  const liveArt = useLiveArt(track);
  const context = usePlayer((s) => s.context);
  const actions = useTrackActions();
  const showViz = useFx("npViz");
  const vizStyle = useFx("vizStyle") as VizStyle;
  const npArt = useFx("npArt");
  const playing = usePlayer((s) => s.playing);
  const tint = useTint();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ nowPlaying: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  return (
    <AnimatePresence>
      {open && track && (
        <motion.div
          key="np"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-[60] overflow-hidden text-white"
          style={{ top: "var(--titlebar-h)" }}
        >
          <div className="absolute inset-0" style={{ background: "var(--art-deep)" }} />
          <AnimatePresence>
            <motion.img
              key={track.id}
              src={artUrl(track.art ?? liveArt, 160)}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2 }}
              className={cn("absolute inset-0 h-full w-full scale-125 object-cover blur-[90px]", tint.filter ? "grayscale" : "saturate-150")}
            />
          </AnimatePresence>
          <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_30%_30%,transparent,rgb(0_0_0/0.55))]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/50" />

          <div className="relative flex h-full flex-col px-8 pb-8 pt-5 md:px-14">
            <div className="flex items-center justify-between">
              <IconButton label="Close Now Playing" round variant="glass" className="text-white" onClick={() => set({ nowPlaying: false })}>
                <ChevronDown size={20} />
              </IconButton>
              <div className="text-center">
                <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-white/55">Playing from</div>
                <div className="text-[13px] font-semibold text-white/90">{context?.label ?? "Your queue"}</div>
              </div>
              <div className="flex gap-1">
                <IconButton label="Lyrics" round variant="glass" className={cn("text-white", lyricsOpen && "text-accent")} onClick={() => set({ lyricsOpen: !lyricsOpen })}>
                  <MicVocal size={18} />
                </IconButton>
                <IconButton label="Queue" round variant="glass" className="text-white" onClick={() => set({ queueOpen: true })}>
                  <ListMusic size={18} />
                </IconButton>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 items-center gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
              <div className="flex min-h-0 justify-center lg:justify-end">
                <TrackContextMenu track={track}>
                  <motion.div
                    className="relative aspect-square w-[min(52vh,520px)]"
                    initial={{ scale: 0.96 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 26 }}
                  >
                    {npArt === "cover" ? (
                      <AlbumArt
                        art={track.art}
                        fallback={liveArt}
                        seed={track.id}
                        size={520}
                        layoutId="np-art"
                        eager
                        className="h-full w-full shadow-[0_40px_120px_-30px_rgb(0_0_0/0.9)]"
                        rounded="rounded-2xl"
                      />
                    ) : (
                      <Record art={track.art ?? liveArt} seed={track.id} spinning={playing} kind={npArt} title={track.title} className="h-full w-full" />
                    )}
                  </motion.div>
                </TrackContextMenu>
              </div>

              <div className="flex min-h-0 max-w-[560px] flex-col justify-center lg:h-[min(52vh,520px)]">
                <AnimatePresence mode="wait">
                  {lyricsOpen ? (
                    <motion.div key="lyrics" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }} className="h-full min-h-0">
                      <Lyrics key={track.id} track={track} />
                    </motion.div>
                  ) : (
                    <motion.div key={track.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: EASE }}>
                      <div className="mb-3 flex items-center gap-2">
                        <SourcePill />
                        {track.popularity.tier && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-white/75">
                            {track.popularity.tier}
                          </span>
                        )}
                      </div>
                      <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-[-0.03em] md:text-5xl">{track.title}</h1>
                      <button onClick={() => { set({ nowPlaying: false }); actions.goArtist(track); }} className="mt-3 text-xl font-medium text-white/75 transition-colors hover:text-white">
                        {track.artist.name}
                      </button>
                      <div className="mt-1 text-sm text-white/50">
                        {[track.album.title, track.year].filter(Boolean).join(" · ")}
                      </div>
                      {track.reasons.length > 0 && <ReasonList reasons={track.reasons} className="mt-5 [&_li]:bg-white/10 [&_li]:text-white/85" />}
                      {track.facets.top.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="What it sounds like">
                          {track.facets.top.map((f) => (
                            <span key={f} className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white/70 ring-1 ring-inset ring-white/10">
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-6 flex items-center gap-2">
                        <LikeButton track={track} size={22} className="h-11 w-11 bg-white/10 text-white hover:bg-white/15" />
                        <IconButton label="Not for me" round variant="glass" className={cn("text-white", track.state.disliked && "text-bad")} onClick={() => actions.dislike(track)}>
                          <ThumbsDown size={18} />
                        </IconButton>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="mx-auto flex w-full max-w-[860px] flex-col items-center gap-3">
              {showViz && (
                <Waveform style={vizStyle} bars={48} className={cn("w-full text-white opacity-90", vizStyle === "smoke" || vizStyle === "wave" ? "h-28" : "h-14")} />
              )}
              <Seekbar large className="[&_span]:text-white/70" />
              <Transport large />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
