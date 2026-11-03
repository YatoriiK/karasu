import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  AudioWaveform,
  CalendarClock,
  CloudSun,
  Dice5,
  Disc3,
  Gem,
  ListPlus,
  Piano,
  Play,
  RadioTower,
  RefreshCw,
  Shuffle,
  Tags,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { usePrefs } from "../store/prefs";
import { useJob } from "../lib/events";
import { EASE } from "../lib/motion";
import type { DiscoverMode, Option, Seed } from "../lib/types";
import { usePlayer } from "../store/player";
import { AlbumArt } from "../components/music/AlbumArt";
import { ArtistCard } from "../components/music/Cards";
import { TrackList } from "../components/music/TrackRow";
import { JobButton } from "../components/discover/JobButton";
import { SeedPicker } from "../components/discover/SeedPicker";
import { Button } from "../components/ui/Button";
import { Chip, Slider } from "../components/ui/controls";
import { cn } from "../components/ui/cn";
import { Carousel } from "../components/ui/Section";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";

const ICONS: Record<string, typeof Gem> = {
  "audio-waveform": AudioWaveform,
  users: Users,
  gem: Gem,
  "disc-3": Disc3,
  tags: Tags,
  "cloud-sun": CloudSun,
  "dice-5": Dice5,
  "calendar-clock": CalendarClock,
  piano: Piano,
  "radio-tower": RadioTower,
};

const ASPECTS = [
  { value: "overall", label: "Overall" },
  { value: "guitar", label: "Guitar" },
  { value: "drums", label: "Drums" },
  { value: "vocals", label: "Vocals" },
  { value: "atmosphere", label: "Atmosphere" },
  { value: "production", label: "Production" },
];

function ModeGrid({ modes, active, onPick }: { modes: DiscoverMode[]; active: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
      {modes.map((m, i) => {
        const Icon = ICONS[m.icon] ?? Gem;
        const on = m.id === active;
        return (
          <motion.button
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025, duration: 0.4, ease: EASE }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onPick(m.id)}
            className={cn(
              "group relative flex flex-col items-start justify-start overflow-hidden rounded-xl p-3.5 text-left transition-colors duration-200",
              on ? "bg-bg-3" : "bg-bg-2/70 hover:bg-bg-3/70",
            )}
          >
            {on && (
              <motion.span
                layoutId="mode-ring"
                className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1.5px_var(--accent)]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className={cn("mb-3 grid h-9 w-9 place-items-center rounded-lg transition-colors", on ? "bg-accent text-accent-fg" : "bg-bg-4 text-fg-1 group-hover:text-fg-0")}>
              <Icon size={18} />
            </span>
            <div className="text-[14px] font-semibold text-fg-0">{m.title}</div>
            <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-fg-2">{m.tagline}</div>
          </motion.button>
        );
      })}
    </div>
  );
}

function OptionChips({ options, value, onPick, limit = 40 }: { options: Option[]; value: string | null; onPick: (id: string) => void; limit?: number }) {
  const [filter, setFilter] = useState("");
  const shown = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, limit);
  return (
    <div>
      {options.length > 14 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="mb-3 h-9 w-56 rounded-lg bg-bg-2 px-3 text-sm text-fg-0 outline-none hairline placeholder:text-fg-3"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {shown.map((o) => (
          <Chip key={o.id} active={value === o.id} onClick={() => onPick(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function DiscoverPage() {
  const { mode: modeParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["discover-options"], queryFn: api.discoverOptions, staleTime: Infinity });
  const { data: top } = useQuery({ queryKey: ["library", "top-seeds"], queryFn: () => api.library("top", 0, 10), staleTime: 300_000 });
  const defaultMode = usePrefs((s) => s.defaultMode);
  const mode = modeParam ?? defaultMode;
  const modeInfo = options?.modes.find((m) => m.id === mode);
  const seed = params.get("seed");
  const seedLabel = params.get("label");
  const aspect = params.get("aspect") ?? "overall";
  const [novelty, setNovelty] = useState(0.2);
  const [committed, setCommitted] = useState(0.2);
  const [nonce, setNonce] = useState<number | null>(null);
  const [analyzeJob, setAnalyzeJob] = useState<string | null>(null);
  const analyze = useJob(analyzeJob);

  const needsSeed = modeInfo?.seed && !modeInfo.seed.endsWith("?");
  const ready = !!modeInfo && (!needsSeed || !!seed);
  const query = useQuery({
    queryKey: ["discover", mode, seed, committed, aspect, nonce],
    queryFn: () => api.discover(mode, { seed, novelty: committed, limit: 40, aspect: aspect === "overall" ? null : aspect, nonce }),
    enabled: ready,
    staleTime: 120_000,
  });

  useEffect(() => {
    if (query.data?.meta.needs_embedding && seed && !analyzeJob) {
      api.analyze(seed).then((r) => setAnalyzeJob(r.job)).catch(() => undefined);
    }
  }, [query.data?.meta.needs_embedding, seed]);
  useEffect(() => {
    if (analyze?.finished) {
      setAnalyzeJob(null);
      qc.invalidateQueries({ queryKey: ["discover"] });
    }
  }, [analyze?.finished]);

  const setSeed = (s: Seed | null) => {
    const next = new URLSearchParams(params);
    if (s) {
      next.set("seed", s.type === "artist" ? `artist:${s.value}` : s.value);
      next.set("label", s.label);
    } else {
      next.delete("seed");
      next.delete("label");
    }
    setParams(next, { replace: true });
  };
  const pickMode = (id: string) => navigate(`/discover/${id}`);
  const items = query.data?.items ?? [];
  const meta = query.data?.meta ?? {};
  const context = useMemo(() => ({ label: meta.title ?? modeInfo?.title ?? "Discover", href: `/discover/${mode}` }), [meta.title, modeInfo, mode]);

  const seedArea = () => {
    if (!modeInfo || !options) return null;
    switch (modeInfo.seed) {
      case "track":
        return (
          <div className="space-y-3">
            <SeedPicker kinds={["track"]} placeholder="Pick a song to match…" onPick={setSeed} className="max-w-xl" />
            {!seed && top?.items.length ? (
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-xs text-fg-3">Or try:</span>
                {top.items.slice(0, 6).map((t) => (
                  <Chip key={t.id} onClick={() => setSeed({ type: "track", value: t.id, label: `${t.title} — ${t.artist.name}` })}>
                    <AlbumArt art={t.art} seed={t.id} size={20} className="-ml-1.5 h-5 w-5" rounded="rounded-full" />
                    <span className="max-w-[180px] truncate">{t.title}</span>
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
        );
      case "artist":
      case "artist?":
        return (
          <div className="space-y-3">
            <SeedPicker kinds={["artist"]} placeholder={modeInfo.seed === "artist?" ? "Optional: one artist's deep cuts…" : "Pick an artist…"} onPick={setSeed} className="max-w-xl" />
            {!seed && top?.items.length ? (
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-xs text-fg-3">Your artists:</span>
                {Array.from(new Map(top.items.filter((t) => t.artist.dz_id).map((t) => [t.artist.dz_id, t])).values())
                  .slice(0, 6)
                  .map((t) => (
                    <Chip key={t.artist.dz_id} onClick={() => setSeed({ type: "artist", value: String(t.artist.dz_id), label: t.artist.name })}>
                      {t.artist.name}
                    </Chip>
                  ))}
              </div>
            ) : null}
          </div>
        );
      case "genre":
        return <OptionChips options={options.genres} value={seed} onPick={(id) => setSeed({ type: "genre", value: id, label: options.genres.find((g) => g.id === id)?.label ?? id })} />;
      case "mood":
        return (
          <div className="space-y-4">
            <OptionChips options={options.activities} value={seed} onPick={(id) => setSeed({ type: "activity", value: id, label: options.activities.find((g) => g.id === id)?.label ?? id })} />
            <OptionChips options={options.moods} value={seed} onPick={(id) => setSeed({ type: "mood", value: id, label: options.moods.find((g) => g.id === id)?.label ?? id })} />
          </div>
        );
      case "decade":
        return <OptionChips options={options.decades} value={seed} onPick={(id) => setSeed({ type: "decade", value: id, label: `${id}s` })} />;
      case "instrument":
        return <OptionChips options={options.instruments} value={seed} onPick={(id) => setSeed({ type: "instrument", value: id, label: options.instruments.find((g) => g.id === id)?.label ?? id })} limit={60} />;
      default:
        return null;
    }
  };

  return (
    <div className="pt-4">
      <header className="mb-7">
        <h1 className="text-[34px] font-bold tracking-[-0.03em]">Discover</h1>
        <p className="mt-1 text-sm text-fg-2">Ten ways in. Every pick tells you why it's here.</p>
      </header>
      {options ? <ModeGrid modes={options.modes} active={mode} onPick={pickMode} /> : <Skeleton className="h-[220px] rounded-xl" />}

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mt-8 rounded-2xl bg-bg-2/50 p-5 hairline"
        >
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              {seed && seedLabel && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-soft py-1 pl-3 pr-1.5 text-[13px] font-semibold text-accent">
                  {seedLabel}
                  <button aria-label="Clear seed" onClick={() => setSeed(null)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-accent/20">
                    <X size={12} />
                  </button>
                </div>
              )}
              {seedArea()}
              {!modeInfo?.seed && <p className="text-sm text-fg-2">{modeInfo?.tagline}. No setup needed.</p>}
            </div>
            <div className="w-full max-w-[300px] space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-xs font-medium text-fg-2">
                  <span>Familiar</span>
                  <span>Adventurous</span>
                </div>
                <Slider value={novelty} onChange={setNovelty} onCommit={setCommitted} label="Adventurousness" />
              </div>
              {mode === "similar" && (
                <div>
                  <div className="mb-2 text-xs font-medium text-fg-2">Match on</div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Match on">
                    {ASPECTS.map((a) => (
                      <Chip
                        key={a.value}
                        active={aspect === a.value}
                        className="h-7 px-3 text-xs"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          if (a.value === "overall") next.delete("aspect");
                          else next.set("aspect", a.value);
                          setParams(next, { replace: true });
                        }}
                      >
                        {a.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      <section className="mt-8">
        {!ready ? (
          <EmptyState icon={<AudioWaveform size={22} />} title={modeInfo ? `Pick ${modeInfo.seed?.startsWith("artist") ? "an artist" : modeInfo.seed === "track" ? "a song" : `a ${modeInfo.seed}`} to start` : "Loading modes"} body={modeInfo?.tagline} />
        ) : analyzeJob ? (
          <EmptyState icon={<AudioWaveform size={22} className="animate-pulse" />} title="Listening to your pick…" body={analyze?.stage ?? "Karasu is analyzing this song's sound for the first time."} />
        ) : query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 rounded-lg" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-[-0.02em]">{meta.title ?? modeInfo?.title}</h2>
                <p className="mt-0.5 text-sm text-fg-2">
                  {meta.subtitle ?? `${items.length} songs`}
                  {meta.aspect ? " · approximate, estimated from 30-second previews" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<Play size={16} fill="currentColor" />} disabled={!items.length} onClick={() => usePlayer.getState().playList(items, 0, context)}>
                  Play all
                </Button>
                <Button
                  variant="secondary"
                  icon={<Shuffle size={16} />}
                  disabled={!items.length}
                  onClick={() => {
                    const s = usePlayer.getState();
                    if (!s.shuffle) s.toggleShuffle();
                    s.playList(items, Math.floor(Math.random() * items.length), context);
                  }}
                >
                  Shuffle
                </Button>
                <Button
                  variant="secondary"
                  icon={<ListPlus size={16} />}
                  disabled={!items.length}
                  onClick={async () => {
                    const created = await api.createPlaylist({ name: meta.title ?? modeInfo?.title ?? "Discoveries", track_ids: items.map((t) => t.id), params: { mode, seed } });
                    qc.invalidateQueries({ queryKey: ["playlists"] });
                    toast(`Saved “${created.name}”`, { action: { label: "Open", onClick: () => navigate(`/playlist/${encodeURIComponent(created.id)}`) } });
                  }}
                >
                  Save as playlist
                </Button>
                {(mode === "random" || mode === "gems") && (
                  <Button variant="ghost" icon={<RefreshCw size={16} />} onClick={() => setNonce(Date.now() % 2 ** 31)}>
                    New picks
                  </Button>
                )}
                <JobButton label="Dig deeper" start={() => api.deeper(mode, seed)} onDone={() => qc.invalidateQueries({ queryKey: ["discover"] })} />
              </div>
            </div>
            {query.data?.artists && query.data.artists.length > 0 && (
              <div className="mb-8">
                <h3 className="mb-3 text-sm font-semibold text-fg-1">Artists in this orbit</h3>
                <Carousel gap={20}>
                  {query.data.artists.map((a) => (
                    <ArtistCard key={a.dz_id} artist={a} width={136} />
                  ))}
                </Carousel>
              </div>
            )}
            {items.length ? (
              <TrackList tracks={items} context={context} />
            ) : (
              <EmptyState
                icon={<Gem size={22} />}
                title="Nothing matched — yet"
                body="Karasu only knows the songs it has listened to. Dig deeper to explore around this pick."
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
