import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, Dice5, Filter, Guitar, RotateCcw, Telescope } from "lucide-react";
import { api } from "../lib/api";
import { EASE, listItem, listParent } from "../lib/motion";
import type { ExploreFilters, GenreCard, Option, SoundCard } from "../lib/types";
import { usePlayer } from "../store/player";
import { AlbumArt, Mosaic } from "../components/music/AlbumArt";
import { TrackCard } from "../components/music/Cards";
import { TrackList } from "../components/music/TrackRow";
import { RangeSlider } from "../components/charts/Charts";
import { Button } from "../components/ui/Button";
import { Chip, Segmented } from "../components/ui/controls";
import { cn } from "../components/ui/cn";
import { Carousel, Section } from "../components/ui/Section";
import { EmptyState, Skeleton } from "../components/ui/states";

function Select({ label, value, options, onChange }: { label: string; value: string | null | undefined; options: Option[]; onChange: (v: string | null) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-2">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-10 w-full rounded-lg bg-bg-3 px-3 text-sm text-fg-0 outline-none hairline"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function GenreTile({ g, tall }: { g: GenreCard; tall?: boolean }) {
  return (
    <motion.div variants={listItem} whileHover={{ y: -3 }}>
      <Link to={`/explore/genre/${g.id}`} className={cn("group relative block overflow-hidden rounded-xl", tall ? "aspect-[4/3]" : "aspect-[16/10]")}>
        <Mosaic arts={g.arts} size={200} className="absolute inset-0 h-full w-full rounded-none opacity-80 transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <div className="truncate text-[15px] font-bold text-white">{g.label}</div>
          <div className="truncate text-xs text-white/70">
            {g.songs.toLocaleString()} songs{g.new ? ` · ${g.new.toLocaleString()} new` : ""}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function SoundBanner({ s }: { s: SoundCard }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }} whileHover={{ y: -3 }}>
      <Link to={`/explore/genre/${s.id}`} className="group relative block overflow-hidden rounded-2xl hairline">
        <div className="absolute inset-0 grid grid-cols-4 opacity-60 transition-transform duration-700 group-hover:scale-[1.03]">
          {s.arts.slice(0, 4).map((a) => (
            <AlbumArt key={a.ref} art={a} size={320} className="h-full w-full" rounded="rounded-none" />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/30" />
        <div className="relative flex min-h-[176px] flex-col justify-end gap-2 p-6 md:p-7">
          <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.18em] text-white/60">
            <Guitar size={14} /> Sound · Guitar
          </div>
          <div className="font-display text-[clamp(28px,3.4vw,40px)] font-bold leading-none tracking-[-0.02em] text-white">{s.label}</div>
          <p className="max-w-xl text-sm leading-relaxed text-white/75">{s.blurb}</p>
          <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-white/80">
            {s.songs.toLocaleString()} songs · {s.new.toLocaleString()} new to you
            <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function ExplorePage() {
  const { data: overview, isLoading } = useQuery({ queryKey: ["explore"], queryFn: api.explore, staleTime: 600_000 });
  const { data: options } = useQuery({ queryKey: ["discover-options"], queryFn: api.discoverOptions, staleTime: Infinity });
  const { data: trending } = useQuery({ queryKey: ["trending"], queryFn: api.trending, staleTime: 3_600_000 });
  const [filters, setFilters] = useState<ExploreFilters>({ sort: "taste" });
  const [energyOn, setEnergyOn] = useState(false);
  const [tempoOn, setTempoOn] = useState(false);
  const [energy, setEnergy] = useState<[number, number]>([0.2, 0.8]);
  const [tempo, setTempo] = useState<[number, number]>([80, 140]);
  const [family, setFamily] = useState<string | null>(null);
  const results = useRef<HTMLDivElement>(null);
  const families = overview?.families ?? [];
  const shownFamily = families.find((f) => f.id === family) ?? families[0];
  const active = !!(filters.genre || filters.mood || filters.instrument || filters.decade || filters.popularity || energyOn || tempoOn);
  const body = { ...filters, energy: energyOn ? energy : null, tempo: tempoOn ? tempo : null };
  const q = useInfiniteQuery({
    queryKey: ["explore-query", body],
    queryFn: ({ pageParam }) => api.exploreQuery({ ...body, limit: 50, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled: active,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (patch: Partial<ExploreFilters>) => setFilters((f) => ({ ...f, ...patch }));
  useEffect(() => {
    if (active) results.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [filters.genre, filters.decade]);

  const random = async () => {
    const r = await api.discover("random", { limit: 12, nonce: Date.now() % 2 ** 31 });
    if (r.items.length) usePlayer.getState().playList(r.items, 0, { label: "Random discovery" });
  };

  return (
    <div className="pt-4">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-[-0.03em]">Explore</h1>
          <p className="mt-1 text-sm text-fg-2">Browse by genre, era and sound — everything ranked by how close it sits to your taste.</p>
        </div>
        <Button variant="secondary" icon={<Dice5 size={16} />} onClick={random}>
          Random song
        </Button>
      </header>

      {overview?.sounds.map((s) => (
        <div key={s.id} className="mb-11">
          <SoundBanner s={s} />
        </div>
      ))}

      <Section
        title="Genres for you"
        subtitle={families.length ? "The genres you love most, and the ones with the most new music for you" : "Ordered by how much they overlap with your taste"}
      >
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
            ))}
          </div>
        ) : families.length ? (
          <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {overview?.genres.slice(0, 12).map((g) => (
              <GenreTile key={g.id} g={g} tall />
            ))}
          </motion.div>
        ) : (
          <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {overview?.genres.slice(0, 18).map((g) => (
              <motion.button
                key={g.id}
                variants={listItem}
                whileHover={{ y: -3 }}
                onClick={() => set({ genre: filters.genre === g.id ? null : g.id })}
                className={cn("group relative aspect-[4/3] overflow-hidden rounded-xl text-left", filters.genre === g.id && "ring-2 ring-accent")}
              >
                <Mosaic arts={g.arts} size={200} className="absolute inset-0 h-full w-full rounded-none opacity-80 transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <div className="text-[15px] font-bold text-white">{g.label}</div>
                  <div className="text-xs text-white/70">{g.count} songs</div>
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </Section>

      {shownFamily && (
        <Section
          title="Browse every genre"
          subtitle={`${Math.round((overview?.coverage ?? 0) * 100)}% of songs are tagged on MusicBrainz; the rest are matched by sound`}
        >
          <div className="no-scrollbar -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {families.map((f) => (
              <button
                key={f.id}
                onClick={() => setFamily(f.id)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  shownFamily.id === f.id ? "bg-fg-0 text-bg-0" : "bg-fg-0/[0.06] text-fg-1 hover:bg-fg-0/[0.1]",
                )}
              >
                {f.label}
                <span className={cn("ml-1.5 tabular", shownFamily.id === f.id ? "text-bg-0/60" : "text-fg-3")}>{f.genres.length}</span>
              </button>
            ))}
          </div>
          <motion.div key={shownFamily.id} variants={listParent} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {shownFamily.genres.map((g) => (
              <GenreTile key={g.id} g={g} />
            ))}
          </motion.div>
        </Section>
      )}

      {overview && overview.decades.length > 0 && (
        <Section title="Travel through time">
          <div className="grid grid-cols-3 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {overview.decades.map((d) => (
              <motion.button
                key={d.id}
                whileHover={{ y: -3 }}
                onClick={() => set({ decade: filters.decade === d.id ? null : d.id })}
                className={cn("group relative aspect-square overflow-hidden rounded-xl", filters.decade === d.id && "ring-2 ring-accent")}
              >
                <Mosaic arts={d.arts} size={160} className="absolute inset-0 h-full w-full rounded-none opacity-70 grayscale-[35%] transition-all duration-500 group-hover:scale-105 group-hover:grayscale-0" />
                <div className="absolute inset-0 bg-black/45" />
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <div className="text-2xl font-black tracking-[-0.03em] text-white">{d.label}</div>
                    <div className="text-xs text-white/70">{d.count} songs</div>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </Section>
      )}

      {trending && trending.length > 0 && (
        <Section title="Trending discoveries" subtitle="What's charting on Deezer that you haven't heard — closest to your taste first">
          <Carousel>
            {trending.slice(0, 16).map((t) => (
              <TrackCard key={t.id} track={t} list={trending} context={{ label: "Trending discoveries" }} showReason={false} />
            ))}
          </Carousel>
        </Section>
      )}

      {overview && overview.underrated.length > 0 && (
        <Section title="Underrated releases" subtitle="Albums by small artists that fit your sound">
          <Carousel>
            {overview.underrated.map((al) => (
              <Link key={al.dz_id} to={`/album/${al.dz_id}`} className="group w-[176px] shrink-0 snap-start">
                <motion.div whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                  <AlbumArt art={al.art} seed={al.title} size={176} className="aspect-square w-full shadow-[0_14px_34px_-18px_rgb(0_0_0/0.85)]" rounded="rounded-xl" />
                </motion.div>
                <div className="mt-2.5 truncate text-[14px] font-semibold">{al.title}</div>
                <div className="truncate text-[13px] text-fg-2">
                  {al.artist}
                  {al.year ? ` · ${al.year}` : ""}
                </div>
              </Link>
            ))}
          </Carousel>
        </Section>
      )}

      <div ref={results} className="scroll-mt-20">
        <Section
          title="Filter everything"
          subtitle="Combine genre, era, sound and popularity"
          action={
            active ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => {
                  setFilters({ sort: "taste" });
                  setEnergyOn(false);
                  setTempoOn(false);
                }}
              >
                Reset
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-4 rounded-2xl bg-bg-2/60 p-5 hairline md:grid-cols-2 xl:grid-cols-4">
            <Select label="Genre" value={filters.genre} options={options?.genres ?? []} onChange={(v) => set({ genre: v })} />
            <Select label="Mood" value={filters.mood} options={options?.moods ?? []} onChange={(v) => set({ mood: v })} />
            <Select label="Instrument or texture" value={filters.instrument} options={options?.instruments ?? []} onChange={(v) => set({ instrument: v })} />
            <Select label="Decade" value={filters.decade} options={options?.decades ?? []} onChange={(v) => set({ decade: v })} />
            <div>
              <span className="mb-1.5 block text-xs font-medium text-fg-2">Artist popularity</span>
              <Segmented
                size="sm"
                value={filters.popularity ?? "any"}
                onChange={(v) => set({ popularity: v === "any" ? null : v })}
                options={[
                  { value: "any", label: "Any" },
                  { value: "underground", label: "Underground" },
                  { value: "niche", label: "Niche" },
                  { value: "known", label: "Known" },
                ]}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-fg-2">
                <button onClick={() => setEnergyOn(!energyOn)} className={cn("transition-colors", energyOn ? "text-accent" : "hover:text-fg-0")}>
                  Energy {energyOn ? "· on" : "· off"}
                </button>
                <span className="tabular">{Math.round(energy[0] * 100)}–{Math.round(energy[1] * 100)}</span>
              </div>
              <div className={cn(!energyOn && "opacity-40")} onPointerDown={() => setEnergyOn(true)}>
                <RangeSlider value={energy} min={0} max={1} step={0.05} onChange={setEnergy} label="Energy range" />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-fg-2">
                <button onClick={() => setTempoOn(!tempoOn)} className={cn("transition-colors", tempoOn ? "text-accent" : "hover:text-fg-0")}>
                  Tempo {tempoOn ? "· on" : "· off"}
                </button>
                <span className="tabular">{tempo[0]}–{tempo[1]} BPM</span>
              </div>
              <div className={cn(!tempoOn && "opacity-40")} onPointerDown={() => setTempoOn(true)}>
                <RangeSlider value={tempo} min={50} max={200} step={5} onChange={setTempo} label="Tempo range" />
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-fg-2">Sort by</span>
              <Segmented
                size="sm"
                value={filters.sort ?? "taste"}
                onChange={(v) => set({ sort: v })}
                options={[
                  { value: "taste", label: "For you" },
                  { value: "obscure", label: "Obscure" },
                  { value: "oldest", label: "Oldest" },
                  { value: "newest", label: "Newest" },
                ]}
              />
            </div>
          </div>
          <div className="mt-3 text-xs text-fg-3">Mood, instruments, energy and tempo are estimated from 30-second previews.</div>
          <div className="mt-6">
            {!active ? (
              <EmptyState icon={<Filter size={22} />} title="Pick a filter to start" body="Choose a genre or decade above, or set any filter here." />
            ) : q.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : items.length ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-fg-2">{q.data?.pages[0].total.toLocaleString()} matches</span>
                  <Button variant="primary" size="sm" onClick={() => usePlayer.getState().playList(items, 0, { label: "Explore" })}>
                    Play all
                  </Button>
                </div>
                <TrackList tracks={items} context={{ label: "Explore" }} />
                {q.hasNextPage && (
                  <div className="mt-4 text-center">
                    <Button variant="secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                      {q.isFetchingNextPage ? "Loading…" : "Show more"}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState icon={<Telescope size={22} />} title="No songs match all of that" body="Loosen a filter, or use Discover → Dig deeper to grow the library Karasu knows." />
            )}
          </div>
        </Section>
      </div>
      {filters.genre && options && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ease: EASE }} className="fixed bottom-28 left-1/2 z-30 -translate-x-1/2">
          <Chip active onClick={() => set({ genre: null })}>
            {options.genres.find((g) => g.id === filters.genre)?.label} ×
          </Chip>
        </motion.div>
      )}
    </div>
  );
}
