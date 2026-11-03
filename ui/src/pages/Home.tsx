import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { Compass, ListPlus, Radar, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { artUrl } from "../lib/art";
import { greeting } from "../lib/format";
import { EASE } from "../lib/motion";
import type { Home, Track } from "../lib/types";
import { currentTrack, usePlayable, usePlayer } from "../store/player";
import { useRunningJobs } from "../lib/events";
import { AlbumArt } from "../components/music/AlbumArt";
import { ArtistCard, PlayFab, PlaylistCard, TrackCard } from "../components/music/Cards";
import { LikeButton } from "../components/music/LikeButton";
import { ReasonList } from "../components/music/Reasons";
import { useTrackActions } from "../components/music/useTrackActions";
import { Button } from "../components/ui/Button";
import { Carousel, Section } from "../components/ui/Section";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";
import { cn } from "../components/ui/cn";
import { TodaySection } from "../components/home/Today";
import { useTint } from "../theme/look";

function Greeting({ data }: { data: Home }) {
  const { name, part } = data.greeting;
  const mood = data.mood;
  return (
    <header className="pb-8 pt-6">
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="text-[clamp(30px,7vw,40px)] font-bold leading-[1.05] tracking-[-0.035em] text-fg-0"
      >
        {greeting(part)}
        {name ? <span className="text-fg-1">, {name}</span> : null}
      </motion.h1>
      {mood && mood.moods.length > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] text-fg-2"
        >
          <span>Lately you're in a</span>
          {mood.moods.slice(0, 2).map((m) => (
            <span key={m} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] font-semibold text-accent">
              {m.toLowerCase()}
            </span>
          ))}
          <span>mood{mood.genres.length ? ` — leaning ${mood.genres.join(" & ").toLowerCase()}` : ""}.</span>
        </motion.p>
      )}
    </header>
  );
}

function QuickTile({ track, list, index }: { track: Track; list: Track[]; index: number }) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.035, duration: 0.45, ease: EASE }}
      className="group relative flex h-14 items-center overflow-hidden rounded-lg bg-fg-0/[0.055] transition-colors duration-200 hover:bg-fg-0/[0.1] sm:h-16"
      onDoubleClick={() => actions.play(track, list, { label: "Recently played" })}
    >
      <AlbumArt art={track.art} seed={track.id} size={64} className="h-14 w-14 sm:h-16 sm:w-16" rounded="rounded-none" />
      <button onClick={() => actions.goTrack(track)} className="min-w-0 flex-1 px-2.5 text-left sm:px-3.5">
        <div className={cn("truncate text-[13px] font-semibold sm:text-[14px]", isCurrent ? "text-accent" : "text-fg-0")}>{track.title}</div>
        <div className="truncate text-xs text-fg-2">{track.artist.name}</div>
      </button>
      {canPlay(track) && (
        <div className={cn("mr-3 hidden transition-all duration-200 sm:block", isCurrent ? "opacity-100" : "translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100")}>
          <PlayFab
            playing={playing}
            size={36}
            onClick={() => (isCurrent ? toggle() : actions.play(track, list, { label: "Recently played" }))}
          />
        </div>
      )}
    </motion.div>
  );
}

function SongOfTheDay({ data }: { data: NonNullable<Home["song_of_day"]> }) {
  const track = data.track!;
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const full = usePlayer((s) => s.source === "spotify");
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const tint = useTint();
  const p = track.art?.palette;
  const list = [track, ...data.similar];
  const another = async () => {
    setBusy(true);
    try {
      const next = await api.anotherSong();
      if (next?.track) qc.setQueryData<Home>(["home"], (old) => (old ? { ...old, song_of_day: next } : old));
      else toast("That's every pick for today", { description: "Come back tomorrow for a fresh one." });
    } catch (e) {
      toast("Couldn't pick another song", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const date = new Date(data.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <motion.section
      initial={{ opacity: 0, y: 16, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.995, transition: { duration: 0.22 } }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.08 }}
      className="relative mb-12 overflow-hidden rounded-[28px] text-white hairline"
    >
      <div
        className="absolute inset-0"
        style={{
          background: p
            ? `linear-gradient(115deg, ${p.glow} 0%, ${p.base} 58%, ${p.deep} 100%)`
            : "linear-gradient(115deg, oklch(0.42 0.06 265), oklch(0.2 0.02 265))",
          ...tint,
        }}
      />
      {track.art && (
        <img src={artUrl(track.art, 160)} alt="" className={cn("absolute -right-24 -top-24 h-[160%] w-[70%] scale-110 object-cover opacity-30 blur-[60px]", tint.filter ? "grayscale" : "saturate-150")} />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgb(0_0_0/0.45),transparent_60%)]" />
      <div className="relative grid items-center gap-8 p-7 md:grid-cols-[minmax(0,248px)_minmax(0,1fr)] md:p-9">
        <motion.div whileHover={{ scale: 1.02, rotate: -0.6 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="relative w-full max-w-[248px]">
          <AlbumArt art={track.art} seed={track.id} size={248} eager className="aspect-square w-full shadow-[0_30px_70px_-24px_rgb(0_0_0/0.85)]" rounded="rounded-2xl" />
          {canPlay(track) && (
            <div className="absolute bottom-3 right-3">
              <PlayFab playing={playing} size={52} onClick={() => (isCurrent ? toggle() : actions.play(track, list, { label: "Song of the day" }))} />
            </div>
          )}
        </motion.div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.18em] text-white/70">
            <Sparkles size={13} />
            Song of the day · {date}
          </div>
          <h2 className="mt-3 text-balance font-display text-[clamp(30px,4vw,48px)] font-bold leading-[1.02] tracking-[-0.02em]">{track.title}</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[15px] text-white/80">
            <button onClick={() => actions.goArtist(track)} className="font-semibold text-white hover:underline underline-offset-4">
              {track.artist.name}
            </button>
            {track.year && <span className="text-white/55">· {track.year}</span>}
            {track.album.title && <span className="truncate text-white/55">· {track.album.title}</span>}
          </div>
          <div className="mt-4 text-[13px] font-medium text-white/60">Why it's here</div>
          <ReasonList reasons={track.reasons} className="mt-2 [&_li]:bg-black/25 [&_li]:text-white/90 [&_li]:shadow-none [&_svg]:!text-white/80" />
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              className="!bg-white !text-black !shadow-none"
              onClick={() => (isCurrent ? toggle() : actions.play(track, list, { label: "Song of the day" }))}
              disabled={!canPlay(track)}
            >
              {playing ? "Pause" : full ? "Play" : "Play preview"}
            </Button>
            <LikeButton track={track} size={20} className="h-12 w-12 bg-black/25 text-white hover:bg-black/35" />
            <Button variant="glass" size="lg" className="!bg-black/25 !text-white !shadow-none hover:!bg-black/35" icon={<ListPlus size={18} />} onClick={() => actions.addToPlaylist([track])}>
              Add
            </Button>
            <Button variant="glass" size="lg" className="!bg-black/25 !text-white !shadow-none hover:!bg-black/35" icon={<Radar size={18} />} onClick={() => actions.goTrack(track)}>
              Similar
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="!text-white/80 hover:!bg-black/20 hover:!text-white"
              icon={<RefreshCw size={17} className={busy ? "animate-spin" : ""} />}
              disabled={busy}
              onClick={another}
            >
              Another
            </Button>
          </div>
        </div>
      </div>
      {data.similar.length > 0 && (
        <div className="relative border-t border-white/10 bg-black/20 px-7 py-4 md:px-9">
          <div className="mb-3 text-2xs font-semibold uppercase tracking-[0.16em] text-white/55">If this hits, try</div>
          <div className="no-scrollbar flex gap-5 overflow-x-auto">
            {data.similar.slice(0, 6).map((t) => (
              <button
                key={t.id}
                onClick={() => actions.play(t, list, { label: "Song of the day" })}
                className="group flex w-[220px] shrink-0 items-center gap-3 text-left"
              >
                <AlbumArt art={t.art} seed={t.id} size={44} className="h-11 w-11 transition-transform duration-300 group-hover:scale-105" rounded="rounded-md" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-white">{t.title}</div>
                  <div className="truncate text-xs text-white/60">{t.artist.name}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.section>
  );
}

function HomeSkeleton() {
  return (
    <div className="pt-6">
      <Skeleton className="h-10 w-[420px] rounded-lg" />
      <Skeleton className="mt-4 h-5 w-[320px]" />
      <div className="mt-8 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-10 h-[330px] rounded-[28px]" />
      <Skeleton className="mt-12 h-6 w-48" />
      <div className="mt-4 flex gap-4 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="w-[176px] shrink-0">
            <Skeleton className="aspect-square rounded-xl" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomePage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["home"], queryFn: api.home, staleTime: 120_000 });
  const jobs = useRunningJobs();
  const preparing = jobs.find((j) => j.kind === "backfill");
  if (isLoading) return <HomeSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const recent = data.recent.filter((t) => t.title);
  const empty = !data.song_of_day?.track && data.discover.length === 0;
  return (
    <div>
      <Greeting data={data} />
      {recent.length > 0 && (
        <div className="mb-11 grid grid-cols-2 gap-2 sm:gap-2.5 xl:grid-cols-4">
          {recent.slice(0, 8).map((t, i) => (
            <QuickTile key={t.id} track={t} list={recent} index={i} />
          ))}
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {data.song_of_day?.track && <SongOfTheDay key={data.song_of_day.track.id} data={data.song_of_day} />}
      </AnimatePresence>
      <TodaySection />
      {empty && (
        <EmptyState
          icon={<Compass size={24} />}
          title={preparing ? "Getting to know your music" : "Nothing to show yet"}
          body={
            preparing
              ? "Karasu is listening to your library for the first time. Recommendations appear here as soon as it's done."
              : "Run a discovery or sync your Spotify library to see recommendations."
          }
        />
      )}
      {data.made_for_you.length > 0 && (
        <Section title="Made for you" subtitle="Playlists Karasu keeps fresh for you" href="/playlists">
          <Carousel>
            {data.made_for_you.map((p) => (
              <PlaylistCard key={p.id} playlist={p} arts={p.track_ids.map((t) => data.made_for_you_art[t])} />
            ))}
            <Link to="/studio" className="group flex w-[176px] shrink-0 snap-start flex-col">
              <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-line-strong text-fg-2 transition-colors group-hover:border-accent group-hover:text-accent">
                <div className="flex flex-col items-center gap-2">
                  <Wand2 size={26} />
                  <span className="text-sm font-semibold">Generate a playlist</span>
                </div>
              </div>
              <div className="mt-2.5 text-[14px] font-semibold text-fg-0">Playlist studio</div>
              <div className="text-[13px] text-fg-2">From a song, mood or era</div>
            </Link>
          </Carousel>
        </Section>
      )}
      {data.because && data.because.tracks.length > 0 && (
        <Section eyebrow="Because you listen to" title={data.because.artist.name ?? "your favorites"} subtitle="Songs that share the sound, from artists you haven't heard">
          <Carousel>
            {data.because.tracks.map((t) => (
              <TrackCard key={t.id} track={t} list={data.because!.tracks} context={{ label: `Because you listen to ${data.because!.artist.name}` }} />
            ))}
          </Carousel>
        </Section>
      )}
      {data.discover.length > 0 && (
        <Section title="Discover something new" subtitle="Small artists, close to your sound" href="/discover">
          <Carousel>
            {data.discover.map((t) => (
              <TrackCard key={t.id} track={t} list={data.discover} context={{ label: "Discover something new" }} />
            ))}
          </Carousel>
        </Section>
      )}
      {data.top_artists.length > 0 && (
        <Section
          title="Your listening"
          subtitle={
            data.activity.plays_week
              ? `${data.activity.plays_week} plays across ${data.activity.artists_week} artists this week`
              : "The artists at the center of your taste"
          }
          href="/stats"
        >
          <Carousel gap={20}>
            {data.top_artists.map((a) => (
              <ArtistCard key={a.name} artist={a} />
            ))}
          </Carousel>
        </Section>
      )}
    </div>
  );
}
