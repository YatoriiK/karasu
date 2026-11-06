import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Gem, ImagePlus, Pause, Play, RefreshCw, SkipBack, SkipForward, Target } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { compact } from "../lib/format";
import type { Home, Track } from "../lib/types";
import { currentTrack, usePlayable, usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { InkImage, Skin, type InkMode } from "../theme/skins";
import { AlbumArt } from "../components/music/AlbumArt";
import { LikeButton } from "../components/music/LikeButton";
import { TrackContextMenu } from "../components/music/TrackMenu";
import { useTrackActions } from "../components/music/useTrackActions";
import { Seekbar } from "../components/player/Seekbar";
import { SearchBox } from "../components/search/SearchBox";
import { cn } from "../components/ui/cn";
import type { Item } from "./types";
import { useFrame } from "./frame";
import { Waveform, type VizStyle } from "../components/viz/Waveform";
import { usePaint } from "./paint";

export type WidgetProps = { item: Item; editing: boolean };

export const prop = <T,>(item: Item, key: string, fallback: T) => (item.props[key] ?? fallback) as T;

function useNow(interval: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), interval);
    return () => window.clearInterval(t);
  }, [interval]);
  return now;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center text-center text-[0.9em] text-fg-3">{children}</div>;
}

function Label({ jp, en }: { jp: string; en: string }) {
  const { titled } = useFrame();
  if (titled) return null;
  return (
    <div className="flex items-baseline gap-[0.5em] text-[0.72em] uppercase tracking-[0.18em] text-fg-3">
      <span className="normal-case tracking-normal">{jp}</span>
      <span>{en}</span>
    </div>
  );
}

function PlayToggle({ track, list, label, size = 18 }: { track: Track; list?: Track[]; label: string; size?: number }) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  return (
    <button
      aria-label={playing ? "Pause" : "Play"}
      disabled={!canPlay(track)}
      onClick={(e) => {
        e.stopPropagation();
        if (isCurrent) toggle();
        else actions.play(track, list, { label });
      }}
      className="grid shrink-0 place-items-center rounded-pill bg-fg-0 text-bg-0 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
      style={{ width: `${size * 2}px`, height: `${size * 2}px` }}
    >
      {playing ? (
        <Skin slot="player.pause" size={size}>
          <Pause size={size} fill="currentColor" strokeWidth={0} />
        </Skin>
      ) : (
        <Skin slot="player.play" size={size}>
          <Play size={size} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />
        </Skin>
      )}
    </button>
  );
}

const WEEK_JP = ["日", "月", "火", "水", "木", "金", "土"];

export function ClockWidget({ item }: WidgetProps) {
  const format = prop<string>(item, "format", "12");
  const seconds = prop(item, "seconds", false);
  const date = prop<string>(item, "date", "jp");
  const align = prop<"left" | "center" | "right">(item, "align", "left");
  const now = useNow(seconds ? 1000 : 5000);
  let hours = now.getHours();
  const ampm = format === "12" ? (hours >= 12 ? "PM" : "AM") : null;
  if (format === "12") hours = hours % 12 || 12;
  const time = `${format === "24" ? String(hours).padStart(2, "0") : hours}:${String(now.getMinutes()).padStart(2, "0")}${
    seconds ? `:${String(now.getSeconds()).padStart(2, "0")}` : ""
  }`;
  const dateText =
    date === "jp"
      ? `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEK_JP[now.getDay()]}曜日`
      : date === "en"
        ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
        : "";
  return (
    <div className={cn("flex h-full flex-col justify-center", align === "center" && "items-center text-center", align === "right" && "items-end text-right")}>
      <div className="ink-glow whitespace-nowrap font-display leading-[0.92] tracking-[-0.02em] text-fg-0" style={{ fontSize: dateText ? "min(60cqh, 26cqw)" : "min(86cqh, 30cqw)" }}>
        {time}
        {ampm && <span className="ml-[0.18em] align-top font-mono text-[0.2em] tracking-normal text-fg-2">{ampm}</span>}
      </div>
      {dateText && <div className="mt-[0.55em] whitespace-nowrap font-mono text-[1em] text-fg-2">{dateText}</div>}
    </div>
  );
}

export function NowPlayingWidget({ item }: WidgetProps) {
  const track = usePlayer(currentTrack);
  const playing = usePlayer((s) => s.playing);
  const { toggle, next, prev } = usePlayer.getState();
  const actions = useTrackActions();
  const showArt = prop(item, "art", true);
  const set = useUi((s) => s.set);
  return (
    <TrackContextMenu track={track}>
      <div className="flex h-full flex-col">
        {showArt && (
          <div className="relative grid min-h-0 flex-1 place-items-center [container-type:size]">
            <button
              onClick={() => track && set({ nowPlaying: true })}
              aria-label="Open Now Playing"
              className="relative overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line-strong)]"
              style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}
            >
              {track ? (
                <AlbumArt art={track.art} seed={track.id} size={320} className="h-full w-full" rounded="rounded-none" />
              ) : (
                <div className="seal grid h-full w-full place-items-center bg-bg-3 text-[3.2em] text-fg-3">烏</div>
              )}
            </button>
          </div>
        )}
        <div className="mt-[0.8em] min-w-0 text-center">
          <button onClick={() => track && actions.goTrack(track)} className="block w-full truncate font-display text-[1.28em] font-bold text-fg-0 hover:underline">
            {track?.title ?? "Nothing playing"}
          </button>
          <div className="truncate text-[0.95em] text-fg-2">{track?.artist.name ?? "pick something to dig into"}</div>
        </div>
        <div className="mt-[0.7em] flex items-center justify-center gap-[1.4em] text-fg-1">
          <button aria-label="Previous" onClick={prev} className="transition-colors hover:text-fg-0">
            <Skin slot="player.prev" size={18}>
              <SkipBack size={18} fill="currentColor" />
            </Skin>
          </button>
          <button aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={!track} className="text-fg-0 transition-transform hover:scale-110 disabled:opacity-40">
            {playing ? (
              <Skin slot="player.pause" size={22}>
                <Pause size={22} fill="currentColor" strokeWidth={0} />
              </Skin>
            ) : (
              <Skin slot="player.play" size={22}>
                <Play size={22} fill="currentColor" strokeWidth={0} />
              </Skin>
            )}
          </button>
          <button aria-label="Next" onClick={() => next()} className="transition-colors hover:text-fg-0">
            <Skin slot="player.next" size={18}>
              <SkipForward size={18} fill="currentColor" />
            </Skin>
          </button>
          {track && <LikeButton track={track} size={16} className="h-7 w-7" live />}
        </div>
        <Seekbar className="mt-[0.4em] [&_span]:font-mono" />
      </div>
    </TrackContextMenu>
  );
}

export function VisualizerWidget({ item }: WidgetProps) {
  const paint = usePaint(item);
  return (
    <Waveform
      paint={paint}
      style={prop<VizStyle>(item, "style", "bars")}
      bars={Number(prop(item, "bars", 24))}
      gap={Number(prop(item, "gap", 0.3))}
      sensitivity={Number(prop(item, "sensitivity", 1))}
      fall={Number(prop(item, "fall", 0.12))}
      strands={Number(prop(item, "strands", 46))}
      thickness={Number(prop(item, "thickness", 1))}
    />
  );
}

export function SearchWidget() {
  return <SearchBox />;
}

function useHome() {
  return useQuery({ queryKey: ["home"], queryFn: api.home, staleTime: 120_000 });
}

function useDaily() {
  return useQuery({ queryKey: ["daily"], queryFn: api.daily, staleTime: 120_000 });
}

export function SotdWidget() {
  const { data } = useHome();
  const qc = useQueryClient();
  const actions = useTrackActions();
  const [busy, setBusy] = useState(false);
  const sotd = data?.song_of_day;
  const track = sotd?.track;
  if (!track) return <Empty>No song of the day yet</Empty>;
  const list = [track, ...(sotd?.similar ?? [])];
  return (
    <TrackContextMenu track={track}>
      <div className="flex h-full gap-[0.9em] [container-type:size]">
        <div className="relative aspect-square h-full max-h-[60cqw] shrink-0">
          <AlbumArt art={track.art} seed={track.id} size={320} className="h-full w-full" rounded="rounded-md" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Label jp="今日の一曲" en="song of the day" />
          <button onClick={() => actions.goTrack(track)} className="line-clamp-2 text-left font-display text-[1.3em] font-bold leading-tight text-fg-0 hover:underline">
            {track.title}
          </button>
          <button onClick={() => actions.goArtist(track)} className="truncate text-left text-[0.95em] text-fg-2 hover:text-fg-0">
            {track.artist.name}
            {track.year ? ` · ${track.year}` : ""}
          </button>
          {track.reasons[0] && <div className="mt-[0.4em] line-clamp-2 text-[0.82em] text-fg-3">{track.reasons[0].text}</div>}
          <div className="mt-auto flex items-center gap-[0.6em] pt-[0.5em]">
            <PlayToggle track={track} list={list} label="Song of the day" size={14} />
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const nextSong = await api.anotherSong();
                  if (nextSong?.track) qc.setQueryData<Home>(["home"], (old) => (old ? { ...old, song_of_day: nextSong } : old));
                } catch (e) {
                  toast("Couldn't pick another song", { description: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
              className="flex items-center gap-[0.4em] rounded-pill px-[0.8em] py-[0.35em] text-[0.82em] text-fg-1 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-fg-0"
            >
              <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> another
            </button>
          </div>
        </div>
      </div>
    </TrackContextMenu>
  );
}

export function ChallengeWidget() {
  const { data } = useDaily();
  const c = data?.challenge;
  if (!c) return <Empty>No challenge today</Empty>;
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex h-full items-center gap-[1em]">
      <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
        <svg width="64" height="64" className="-rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="4" />
          <motion.circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ * (1 - c.progress / c.goal) }}
            transition={{ duration: 1 }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center font-mono text-[0.95em] font-bold text-fg-0">
          {c.done ? "済" : `${c.progress}/${c.goal}`}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <Label jp="今日の課題" en={c.streak ? `streak ${c.streak}` : "challenge"} />
        <div className="mt-[0.25em] truncate font-display text-[1.15em] font-bold text-fg-0">{c.title}</div>
        <div className="line-clamp-2 text-[0.85em] text-fg-2">{c.done ? "Done for today." : c.body}</div>
        {!c.done && (
          <Link to={c.action.to} className="mt-[0.3em] inline-flex items-center gap-[0.3em] text-[0.82em] text-fg-1 underline decoration-line-strong underline-offset-4 hover:text-fg-0">
            <Target size={12} /> {c.action.label.toLowerCase()}
          </Link>
        )}
      </div>
    </div>
  );
}

export function MixWidget() {
  const { data } = useDaily();
  const isPlaying = usePlayer((s) => s.playing && s.context?.label === "Daily Mix");
  const mix = data?.mix;
  if (!mix) return <Empty>Daily Mix appears after the first analysis</Empty>;
  const covers = mix.tracks.filter((t) => t.art).slice(0, 4);
  return (
    <div className="flex h-full flex-col">
      <Link to="/playlist/daily%3Amix" className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 overflow-hidden rounded-md">
        {covers.map((t) => (
          <AlbumArt key={t.id} art={t.art} seed={t.id} size={160} rounded="rounded-none" className="h-full w-full" />
        ))}
      </Link>
      <div className="mt-[0.7em] flex items-center gap-[0.7em]">
        <div className="min-w-0 flex-1">
          <div className="font-display text-[1.2em] font-bold text-fg-0">Daily Mix</div>
          <div className="truncate text-[0.82em] text-fg-3">
            {mix.known} old · {mix.new} new · {mix.tracks.length} songs
          </div>
        </div>
        <button
          aria-label={isPlaying ? "Pause" : "Play Daily Mix"}
          onClick={() => {
            const s = usePlayer.getState();
            if (isPlaying) s.toggle();
            else s.playList(mix.tracks, 0, { label: "Daily Mix", href: "/playlist/daily%3Amix" });
          }}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-fg-0 text-bg-0"
        >
          {isPlaying ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" strokeWidth={0} />}
        </button>
      </div>
    </div>
  );
}

export function ArtistWidget() {
  const { data } = useDaily();
  const a = data?.artist;
  if (!a) return <Empty>No artist today</Empty>;
  const art = a.art ?? a.tracks[0]?.art ?? null;
  return (
    <div className="flex h-full items-center gap-[1em]">
      <Link to={`/artist/${a.dz_id}`} className="shrink-0">
        <AlbumArt art={art} seed={a.name} size={160} rounded="rounded-full" className="h-[5.2em] w-[5.2em]" />
      </Link>
      <div className="min-w-0 flex-1">
        <Label jp="今日の人" en="artist of the day" />
        <Link to={`/artist/${a.dz_id}`} className="mt-[0.2em] block truncate font-display text-[1.25em] font-bold text-fg-0 hover:underline">
          {a.name}
        </Link>
        <div className="truncate text-[0.85em] text-fg-2">
          {a.fans != null ? `${compact(a.fans)} fans` : "new to you"}
          {a.reason ? ` · ${a.reason.toLowerCase()}` : ""}
        </div>
      </div>
      {a.tracks[0] && <PlayToggle track={a.tracks[0]} list={a.tracks} label={`Artist of the day · ${a.name}`} size={13} />}
    </div>
  );
}

export function AlbumWidget() {
  const { data } = useDaily();
  const al = data?.album;
  if (!al) return <Empty>No album today</Empty>;
  return (
    <Link to={`/album/${al.dz_id}`} className="flex h-full gap-[0.9em]">
      <AlbumArt art={al.art} seed={al.title} size={320} rounded="rounded-md" className="aspect-square h-full shrink-0" />
      <div className="flex min-w-0 flex-col justify-center">
        <Label jp="今日の一枚" en="album of the day" />
        <div className="mt-[0.3em] line-clamp-2 font-display text-[1.2em] font-bold leading-tight text-fg-0">{al.title}</div>
        <div className="truncate text-[0.9em] text-fg-2">
          {al.artist}
          {al.year ? ` · ${al.year}` : ""}
        </div>
      </div>
    </Link>
  );
}

export function GemWidget() {
  const { data } = useDaily();
  const t = data?.gem;
  const actions = useTrackActions();
  if (!t) return <Empty>No hidden gem today</Empty>;
  return (
    <TrackContextMenu track={t}>
      <div className="flex h-full gap-[0.9em]">
        <div className="relative aspect-square h-full shrink-0">
          <AlbumArt art={t.art} seed={t.id} size={320} rounded="rounded-md" className="h-full w-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <Label jp="隠れた名曲" en="hidden gem" />
          <button onClick={() => actions.goTrack(t)} className="mt-[0.3em] line-clamp-2 text-left font-display text-[1.2em] font-bold leading-tight text-fg-0 hover:underline">
            {t.title}
          </button>
          <div className="truncate text-[0.9em] text-fg-2">{t.artist.name}</div>
          <div className="mt-[0.25em] flex items-center gap-[0.35em] text-[0.8em] text-fg-3">
            <Gem size={11} /> {t.popularity.fans != null ? `${compact(t.popularity.fans)} fans` : "barely known"}
          </div>
        </div>
        <div className="self-center">
          <PlayToggle track={t} list={[t]} label="Hidden gem" size={13} />
        </div>
      </div>
    </TrackContextMenu>
  );
}

export function FetchWidget() {
  const { data } = useQuery({ queryKey: ["fetch"], queryFn: api.fetchInfo, staleTime: 60_000 });
  const rows: [string, string][] = data
    ? [
        ["library", `${data.library.toLocaleString()} songs`],
        ["artists", data.artists.toLocaleString()],
        ["heard", `${data.analyzed.toLocaleString()} analyzed`],
        ["found", `${data.discovered.toLocaleString()} · kept ${data.kept}`],
        ["taste", (data.genres.join(" · ") || "still listening").toLowerCase()],
        ["mood", (data.moods.slice(0, 2).join(" · ") || "—").toLowerCase()],
        ["week", `${data.plays_week} plays`],
        ["streak", `${data.streak} day${data.streak === 1 ? "" : "s"}`],
      ]
    : [];
  return (
    <div className="flex h-full gap-[1.3em] font-mono text-[0.86em] [container-type:size]">
      <div className="seal ink-glow grid shrink-0 place-items-center text-fg-0" style={{ fontSize: "min(62cqh, 20cqw)" }}>
        烏
      </div>
      <div className="min-w-0 flex-1 overflow-hidden leading-[1.36]">
        <div className="truncate">
          <span className="font-bold text-fg-0">{data?.user ?? "you"}</span>
          <span className="text-fg-3">@</span>
          <span className="text-fg-1">karasu</span>
        </div>
        <div className="my-[0.3em] h-px w-[12em] max-w-full bg-line-strong" />
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-[0.9em]">
            <span className="w-[5em] shrink-0 text-fg-3">{k}</span>
            <span className="truncate text-fg-1">{v}</span>
          </div>
        ))}
        <div className="mt-[0.4em] flex items-center gap-[0.5em] text-fg-2">
          <span>➜</span>
          <span>~</span>
          <span className="inline-block h-[1.05em] w-[0.55em] animate-pulse bg-fg-1" />
        </div>
      </div>
    </div>
  );
}

function MiniRow({ track, list, label }: { track: Track; list: Track[]; label: string }) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  return (
    <TrackContextMenu track={track}>
      <button
        onClick={() => actions.play(track, list, { label })}
        disabled={!canPlay(track)}
        className="flex w-full items-center gap-[0.7em] rounded-sm py-[0.25em] text-left hover:bg-fg-0/5"
      >
        <AlbumArt art={track.art} seed={track.id} size={64} rounded="rounded-sm" className="h-[2.3em] w-[2.3em]" />
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[0.95em]", isCurrent ? "font-bold text-fg-0" : "text-fg-1")}>{track.title}</div>
          <div className="truncate text-[0.8em] text-fg-3">{track.artist.name}</div>
        </div>
      </button>
    </TrackContextMenu>
  );
}

export function QueueWidget({ item }: WidgetProps) {
  const queue = usePlayer((s) => s.queue);
  const order = usePlayer((s) => s.order);
  const index = usePlayer((s) => s.index);
  const limit = Number(prop(item, "limit", 6));
  const pos = order.indexOf(index);
  const upcoming = (pos >= 0 ? order.slice(pos + 1) : []).map((i) => queue[i]).filter(Boolean).slice(0, limit);
  if (!upcoming.length) return <Empty>Queue is empty</Empty>;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {upcoming.map((t) => (
        <MiniRow key={t.id} track={t} list={queue} label="Queue" />
      ))}
    </div>
  );
}

export function RecentWidget({ item }: WidgetProps) {
  const { data } = useHome();
  const recent = (data?.recent ?? []).filter((t) => t.title).slice(0, Number(prop(item, "limit", 6)));
  if (!recent.length) return <Empty>Nothing played yet</Empty>;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {recent.map((t) => (
        <MiniRow key={t.id} track={t} list={recent} label="Recently played" />
      ))}
    </div>
  );
}

export function PlaylistsWidget() {
  const { data } = useHome();
  const lists = data?.made_for_you ?? [];
  return (
    <div className="flex h-full flex-col gap-[0.35em] overflow-hidden">
      <Link to="/playlist/daily%3Amix" className="flex items-center justify-between rounded-sm px-[0.4em] py-[0.35em] hover:bg-fg-0/5">
        <span className="text-fg-0">Daily Mix</span>
        <span className="text-[0.8em] text-fg-3">today</span>
      </Link>
      {lists.map((p) => (
        <Link key={p.id} to={`/playlist/${encodeURIComponent(p.id)}`} className="flex items-center justify-between rounded-sm px-[0.4em] py-[0.35em] hover:bg-fg-0/5">
          <span className="truncate text-fg-1">{p.name}</span>
          <span className="shrink-0 text-[0.8em] text-fg-3">{p.count}</span>
        </Link>
      ))}
    </div>
  );
}

export function CalendarWidget() {
  const today = new Date();
  const [offset, setOffset] = useState(0);
  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const { data } = useQuery({ queryKey: ["stats", "month"], queryFn: () => api.stats("month"), staleTime: 300_000 });
  const played = useMemo(() => new Set((data?.series ?? []).filter((s) => s.plays > 0).map((s) => s.date)), [data]);
  const first = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, i) => i - first + 1);
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <div className="flex h-full flex-col font-mono">
      <div className="mb-[0.5em] flex items-center justify-between">
        <span className="text-[1em] text-fg-0">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <span className="flex gap-[0.2em]">
          <button aria-label="Previous month" onClick={() => setOffset(offset - 1)} className="text-fg-2 hover:text-fg-0">
            <ChevronLeft size={15} />
          </button>
          <button aria-label="Next month" onClick={() => setOffset(offset + 1)} className="text-fg-2 hover:text-fg-0">
            <ChevronRight size={15} />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 border-b border-line pb-[0.3em] text-center text-[0.75em] text-fg-3">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 text-center text-[0.85em]">
        {cells.map((d, i) => {
          const inMonth = d >= 1 && d <= days;
          const isToday = inMonth && offset === 0 && d === today.getDate();
          const date = new Date(month.getFullYear(), month.getMonth(), d);
          return (
            <span
              key={i}
              className={cn(
                "relative m-[1px] grid place-items-center",
                !inMonth && "text-fg-3/50",
                inMonth && "text-fg-1",
                isToday && "bg-fg-0 font-bold text-bg-0",
              )}
            >
              {date.getDate()}
              {inMonth && played.has(key(d)) && !isToday && <span className="absolute bottom-[12%] h-[3px] w-[3px] rounded-full bg-fg-1" />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function StatsWidget() {
  const { data } = useQuery({ queryKey: ["stats", "week"], queryFn: () => api.stats("week"), staleTime: 300_000 });
  const series = data?.series ?? [];
  const max = Math.max(1, ...series.map((s) => s.plays));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-[0.5em]">
        <span className="font-display text-[2em] font-bold leading-none text-fg-0">{data?.plays ?? "—"}</span>
        <span className="text-[0.85em] text-fg-3">plays this week</span>
      </div>
      <div className="mt-[0.2em] text-[0.8em] text-fg-3">
        {data ? `${data.artists} artists · ${data.new_pct}% new` : ""}
      </div>
      <div className="mt-[0.7em] flex min-h-0 flex-1 items-end gap-[3px]">
        {series.map((s) => (
          <div key={s.date} title={`${s.date} · ${s.plays} plays`} className="flex-1 bg-fg-0" style={{ height: `${Math.max(3, (s.plays / max) * 100)}%`, opacity: s.plays ? 0.85 : 0.15 }} />
        ))}
      </div>
    </div>
  );
}

export function ImageWidget({ item, editing }: WidgetProps) {
  const asset = prop<string | null>(item, "asset", null);
  const fit = prop<"contain" | "cover">(item, "fit", "contain");
  const raw = prop<string>(item, "ink", "ink");
  const mode = (raw === "auto" || raw === "paper" ? "ink" : raw) as InkMode;
  const gray = prop(item, "grayscale", false);
  const flipX = prop(item, "flipX", false);
  const flipY = prop(item, "flipY", false);
  if (!asset)
    return editing ? (
      <div className="grid h-full place-items-center border border-dashed border-line-strong text-center text-[0.85em] text-fg-3">
        <span className="flex flex-col items-center gap-1">
          <ImagePlus size={20} /> pick an image in the panel
        </span>
      </div>
    ) : null;
  return (
    <InkImage
      asset={asset}
      mode={mode}
      fit={fit}
      grayscale={gray}
      size={Math.max(item.w, item.h) > 600 ? 1280 : 640}
      className="pointer-events-none h-full w-full select-none text-fg-0"
      style={{ transform: flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined }}
    />
  );
}

export function TextWidget({ item }: WidgetProps) {
  const text = prop(item, "text", "烏");
  const vertical = prop(item, "vertical", false);
  const align = prop<"left" | "center" | "right">(item, "align", "center");
  const weight = prop(item, "weight", 400);
  const spacing = prop(item, "spacing", 0);
  const size = prop(item, "size", 1);
  const glow = prop(item, "glow", true);
  return (
    <div
      className={cn("flex h-full w-full overflow-hidden whitespace-pre-wrap text-fg-0", glow && "ink-glow", align === "center" ? "items-center justify-center" : align === "right" ? "items-center justify-end" : "items-center justify-start")}
      style={{ textAlign: align, writingMode: vertical ? "vertical-rl" : undefined, fontWeight: weight, letterSpacing: `${spacing}em`, fontSize: `calc(${size} * min(60cqh, 40cqw))`, lineHeight: 1.05 }}
    >
      {text}
    </div>
  );
}

export function ShapeWidget({ item }: WidgetProps) {
  const shape = prop<"rect" | "circle" | "line">(item, "shape", "line");
  const stroke = prop(item, "stroke", 2);
  const fill = prop(item, "fill", false);
  const dash = prop(item, "dashed", false);
  const common = { borderStyle: dash ? "dashed" : "solid", borderWidth: stroke, borderColor: "currentColor" } as const;
  if (shape === "line") return <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-fg-0" style={{ height: 0, borderTopStyle: common.borderStyle, borderTopWidth: stroke, borderTopColor: "currentColor" }} />;
  return <div className={cn("h-full w-full text-fg-0", shape === "circle" && "rounded-full", fill && "bg-current")} style={common} />;
}
