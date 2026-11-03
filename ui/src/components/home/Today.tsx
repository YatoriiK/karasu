import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { ArrowRight, AudioWaveform, Check, Flame, Gem, ListPlus, Play, Target } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { compact, tierLabel } from "../../lib/format";
import { EASE } from "../../lib/motion";
import { useTint } from "../../theme/look";
import type { Challenge, Daily, Track } from "../../lib/types";
import { currentTrack, usePlayable, usePlayer } from "../../store/player";
import { AlbumArt } from "../music/AlbumArt";
import { PlayFab } from "../music/Cards";
import { TrackContextMenu } from "../music/TrackMenu";
import { useTrackActions } from "../music/useTrackActions";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Skeleton } from "../ui/states";

const tile = "relative overflow-hidden rounded-[22px] bg-bg-2 hairline";

function Eyebrow({ icon, children, light }: { icon?: ReactNode; children: ReactNode; light?: boolean }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em]", light ? "text-white/70" : "text-fg-3")}>
      {icon}
      {children}
    </div>
  );
}

function rise(i: number) {
  return {
    initial: { opacity: 0, y: 14 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-40px" },
    transition: { duration: 0.55, ease: EASE, delay: i * 0.06 },
  };
}

function MixTile({ mix }: { mix: NonNullable<Daily["mix"]> }) {
  const navigate = useNavigate();
  const tracks = mix.tracks;
  const covers = tracks.filter((t) => t.art).slice(0, 4);
  const context = { label: "Daily Mix", href: "/playlist/daily%3Amix" };
  const isPlaying = usePlayer((s) => s.playing && s.context?.label === "Daily Mix");
  const names = [...new Set(tracks.map((t) => t.artist.name))].slice(0, 3);
  const save = async () => {
    const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    try {
      const pl = await api.createPlaylist({ name: `Daily Mix · ${date}`, description: "Saved from Karasu's Daily Mix", track_ids: tracks.map((t) => t.id) });
      toast("Saved to your playlists", { action: { label: "Open", onClick: () => navigate(`/playlist/${encodeURIComponent(pl.id)}`) } });
    } catch (e) {
      toast("Couldn't save the mix", { description: (e as Error).message });
    }
  };
  return (
    <motion.div {...rise(0)} className={cn(tile, "group min-h-[340px] md:col-span-2 lg:row-span-2")}>
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
        {covers.map((t) => (
          <AlbumArt key={t.id} art={t.art} seed={t.id} size={320} rounded="rounded-none" className="h-full w-full transition-transform duration-[1.2s] ease-[var(--ease-out)] group-hover:scale-[1.04]" />
        ))}
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.15)_0%,rgb(0_0_0/0.55)_45%,rgb(0_0_0/0.9)_100%)]" />
      <div className="relative flex h-full flex-col justify-end p-6 text-white md:p-7">
        <Eyebrow light icon={<AudioWaveform size={13} />}>Refreshed every morning</Eyebrow>
        <h3 className="mt-2 text-[34px] font-bold leading-none tracking-[-0.035em]">Daily Mix</h3>
        <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-white/75">
          {mix.known} favorites and {mix.new} new finds that rise and fall in energy, with {names.join(", ")} and more.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="lg"
            className="!bg-white !text-black !shadow-none"
            icon={<Play size={17} fill="currentColor" />}
            onClick={() => {
              const s = usePlayer.getState();
              if (isPlaying) s.toggle();
              else s.playList(tracks, 0, context);
            }}
          >
            {isPlaying ? "Pause" : "Play mix"}
          </Button>
          <Button variant="glass" size="lg" className="!bg-white/12 !text-white !shadow-none hover:!bg-white/20" icon={<ListPlus size={17} />} onClick={save}>
            Save
          </Button>
          <Link to="/playlist/daily%3Amix" className="ml-1 inline-flex items-center gap-1.5 text-[14px] font-semibold text-white/80 transition-colors hover:text-white">
            {tracks.length} songs <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

function MiniTrack({ track, list, label }: { track: Track; list: Track[]; label: string }) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  return (
    <TrackContextMenu track={track}>
      <button
        onClick={() => (isCurrent ? toggle() : actions.play(track, list, { label }))}
        disabled={!canPlay(track)}
        className="group/mini flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-fg-0/[0.06]"
      >
        <div className="relative">
          <AlbumArt art={track.art} seed={track.id} size={40} className="h-10 w-10" rounded="rounded-md" />
          <div className={cn("absolute inset-0 grid place-items-center rounded-md bg-black/45 text-white transition-opacity", isCurrent ? "opacity-100" : "opacity-0 group-hover/mini:opacity-100")}>
            {playing ? <span className="text-[11px] font-bold">II</span> : <Play size={14} fill="currentColor" />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[13.5px] font-semibold", isCurrent ? "text-accent" : "text-fg-0")}>{track.title}</div>
          <div className="truncate text-xs text-fg-2">{track.album.title ?? track.artist.name}</div>
        </div>
      </button>
    </TrackContextMenu>
  );
}

function ArtistTile({ artist }: { artist: NonNullable<Daily["artist"]> }) {
  const tint = useTint();
  const art = artist.art ?? artist.tracks[0]?.art ?? null;
  const p = art?.palette;
  return (
    <motion.div {...rise(1)} className={cn(tile, "p-5 md:col-span-2 md:p-6")}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: p
            ? `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${p.glow} 38%, transparent), transparent 62%)`
            : "radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 62%)",
          ...tint,
        }}
      />
      <div className="relative flex items-center gap-5">
        <Link to={`/artist/${artist.dz_id}`} className="shrink-0">
          <AlbumArt art={art} seed={artist.name} size={112} rounded="rounded-full" className="h-24 w-24 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.9)] md:h-28 md:w-28" />
        </Link>
        <div className="min-w-0">
          <Eyebrow>Artist of the day</Eyebrow>
          <Link to={`/artist/${artist.dz_id}`} className="mt-1.5 block truncate text-[26px] font-bold leading-tight tracking-[-0.03em] text-fg-0 hover:underline underline-offset-4">
            {artist.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-2">
            {artist.fans != null && <span>{compact(artist.fans)} fans</span>}
            {artist.tier && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-semibold text-accent">{tierLabel[artist.tier]}</span>}
          </div>
          {artist.reason && (
            <div className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-1">
              <AudioWaveform size={14} className="shrink-0 text-accent" />
              <span className="truncate">{artist.reason}</span>
            </div>
          )}
        </div>
      </div>
      <div className="relative mt-4 grid gap-0.5 sm:grid-cols-2">
        {artist.tracks.slice(0, 2).map((t) => (
          <MiniTrack key={t.id} track={t} list={artist.tracks} label={`Artist of the day · ${artist.name}`} />
        ))}
      </div>
    </motion.div>
  );
}

function AlbumTile({ album }: { album: NonNullable<Daily["album"]> }) {
  const actions = useTrackActions();
  return (
    <motion.div {...rise(2)} className={cn(tile, "group flex flex-col p-4")}>
      <Link to={`/album/${album.dz_id}`} className="relative block">
        <AlbumArt art={album.art} seed={album.title} size={320} className="aspect-square w-full transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.02]" rounded="rounded-xl" />
        <div className="absolute bottom-2.5 right-2.5 translate-y-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <PlayFab playing={false} size={42} label="Play album picks" onClick={() => actions.play(album.tracks[0], album.tracks, { label: `Album of the day · ${album.title}`, href: `/album/${album.dz_id}` })} />
        </div>
      </Link>
      <div className="mt-3.5 min-w-0">
        <Eyebrow>Album of the day</Eyebrow>
        <Link to={`/album/${album.dz_id}`} className="mt-1 line-clamp-2 block text-[16px] font-bold leading-snug tracking-[-0.01em] text-fg-0 hover:underline underline-offset-2">
          {album.title}
        </Link>
        <div className="mt-0.5 truncate text-[13px] text-fg-2">
          {album.artist}
          {album.year ? ` · ${album.year}` : ""}
        </div>
        <div className="mt-1.5 truncate text-xs text-fg-3">{album.reason}</div>
      </div>
    </motion.div>
  );
}

function GemTile({ track }: { track: Track }) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  const fans = track.popularity.fans;
  return (
    <TrackContextMenu track={track}>
      <motion.div {...rise(3)} className={cn(tile, "group flex flex-col p-4")}>
        <div className="relative cursor-pointer" onClick={() => actions.goTrack(track)}>
          <AlbumArt art={track.art} seed={track.id} size={320} className="aspect-square w-full transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.02]" rounded="rounded-xl" />
          <div className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-2xs font-semibold text-white backdrop-blur-md">
            <Gem size={12} /> {fans != null ? `${compact(fans)} fans` : "Hidden gem"}
          </div>
          {canPlay(track) && (
            <div className={cn("absolute bottom-2.5 right-2.5 transition-all duration-200", isCurrent ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100")}>
              <PlayFab playing={playing} size={42} onClick={() => (isCurrent ? toggle() : actions.play(track, [track], { label: "Hidden gem of the day" }))} />
            </div>
          )}
        </div>
        <div className="mt-3.5 min-w-0">
          <Eyebrow>Hidden gem</Eyebrow>
          <button onClick={() => actions.goTrack(track)} className={cn("mt-1 line-clamp-2 block text-left text-[16px] font-bold leading-snug tracking-[-0.01em] hover:underline underline-offset-2", isCurrent ? "text-accent" : "text-fg-0")}>
            {track.title}
          </button>
          <button onClick={() => actions.goArtist(track)} className="mt-0.5 block max-w-full truncate text-[13px] text-fg-2 hover:text-fg-0">
            {track.artist.name}
            {track.year ? ` · ${track.year}` : ""}
          </button>
          {track.reasons[0] && <div className="mt-1.5 truncate text-xs text-fg-3">{track.reasons[0].text}</div>}
        </div>
      </motion.div>
    </TrackContextMenu>
  );
}

function Ring({ value, goal, done }: { value: number; goal: number; done: boolean }) {
  const size = 76;
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="6" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? "var(--good)" : "var(--accent)"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - value / goal) }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        {done ? (
          <Check size={26} className="text-good" strokeWidth={2.6} />
        ) : (
          <span className="text-[17px] font-bold tabular text-fg-0">
            {value}
            <span className="text-fg-3">/{goal}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function ChallengeTile({ challenge }: { challenge: Challenge }) {
  return (
    <motion.div {...rise(4)} className={cn(tile, "flex flex-col gap-5 p-5 sm:flex-row sm:items-center md:col-span-2 md:p-6 lg:col-span-4")}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 140% at 100% 50%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%)" }}
      />
      <div className="relative flex min-w-0 flex-1 items-center gap-5">
        <Ring value={challenge.progress} goal={challenge.goal} done={challenge.done} />
        <div className="min-w-0">
          <Eyebrow icon={<Target size={13} />}>Daily challenge</Eyebrow>
          <div className="mt-1.5 text-[20px] font-bold tracking-[-0.02em] text-fg-0">{challenge.title}</div>
          <div className="mt-0.5 text-[14px] text-fg-2">
            {challenge.done ? "Done for today. Nice digging. New challenge tomorrow." : challenge.body}
          </div>
          <div className="mt-1 text-xs text-fg-3">Counts plays here and in Spotify (Spotify plays show up within 30 minutes).</div>
        </div>
      </div>
      <div className="relative flex shrink-0 items-center gap-3">
        {challenge.streak > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent">
            <Flame size={15} /> {challenge.streak}-day streak
          </div>
        )}
        {!challenge.done && (
          <Link to={challenge.action.to}>
            <Button variant="primary" icon={<ArrowRight size={16} />}>
              {challenge.action.label}
            </Button>
          </Link>
        )}
      </div>
    </motion.div>
  );
}

function TodaySkeleton() {
  return (
    <div className="mb-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Skeleton className="h-[340px] rounded-[22px] md:col-span-2 lg:row-span-2 lg:h-auto" />
      <Skeleton className="h-[196px] rounded-[22px] md:col-span-2" />
      <Skeleton className="h-[300px] rounded-[22px]" />
      <Skeleton className="h-[300px] rounded-[22px]" />
    </div>
  );
}

export function TodaySection() {
  const { data, isLoading } = useQuery({ queryKey: ["daily"], queryFn: api.daily, staleTime: 120_000 });
  if (isLoading) return <TodaySkeleton />;
  if (!data || (!data.mix && !data.artist && !data.album && !data.gem)) return null;
  const date = new Date(data.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
  return (
    <section className="mb-12">
      <div className="mb-4">
        <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">{date}'s picks</div>
        <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-fg-0">Today in the crate</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {data.mix && <MixTile mix={data.mix} />}
        {data.artist && <ArtistTile artist={data.artist} />}
        {data.album && <AlbumTile album={data.album} />}
        {data.gem && <GemTile track={data.gem} />}
        {data.challenge && <ChallengeTile challenge={data.challenge} />}
      </div>
    </section>
  );
}

