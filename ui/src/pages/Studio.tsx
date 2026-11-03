import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, History, Loader2, Play, Plus, RefreshCw, Save, Shuffle, Sparkles, UploadCloud, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Popover } from "radix-ui";
import { api } from "../lib/api";
import { EASE } from "../lib/motion";
import { openExternal } from "../lib/tauri";
import type { GenerateParams, GenerateResult, Option, Seed, Track } from "../lib/types";
import { usePlayer } from "../store/player";
import { AlbumArt } from "../components/music/AlbumArt";
import { ReasonLine } from "../components/music/Reasons";
import { SeedPicker } from "../components/discover/SeedPicker";
import { Button, IconButton } from "../components/ui/Button";
import { Chip, Segmented, Slider, Toggle } from "../components/ui/controls";
import { cn } from "../components/ui/cn";
import { EmptyState } from "../components/ui/states";

const SHAPES = [
  { value: "steady", label: "Steady", path: "M2 12 L30 12" },
  { value: "build", label: "Build", path: "M2 18 C12 16 20 8 30 4" },
  { value: "wave", label: "Wave", path: "M2 12 C7 2 12 2 16 12 S25 22 30 12" },
  { value: "winddown", label: "Wind down", path: "M2 4 C12 6 20 14 30 18" },
] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-fg-0">{label}</span>
        {hint && <span className="text-xs text-fg-3 tabular">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ChipPopover({ label, options, onPick }: { label: string; options: Option[]; onPick: (o: Option) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-3 px-3 text-[13px] font-medium text-fg-1 hairline transition-colors hover:bg-bg-4 hover:text-fg-0">
          <Plus size={13} /> {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="start" className="z-[70] max-h-80 w-[340px] overflow-y-auto rounded-xl bg-bg-3 p-3 elevated data-[state=open]:animate-[menu-in_160ms_var(--ease-out)]">
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <Chip
                key={o.id}
                onClick={() => {
                  onPick(o);
                  setOpen(false);
                }}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function EnergyChart({ values }: { values: (number | null)[] }) {
  const w = 600;
  const h = 64;
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * w, h - 6 - (v ?? 0.5) * (h - 12)] as const);
  if (pts.length < 2) return null;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full" aria-label="Energy across the playlist">
      <defs>
        <linearGradient id="energy-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#energy-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
      <motion.path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE }} />
    </svg>
  );
}

function DraftRow({ track, index, onReplace, onRemove, busy }: { track: Track; index: number; onReplace: () => void; onRemove: () => void; busy: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group grid h-14 grid-cols-[22px_24px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2", isDragging ? "z-10 bg-bg-4 shadow-xl" : "hover:bg-bg-2")}
    >
      <button {...attributes} {...listeners} aria-label="Drag to reorder" className="cursor-grab text-fg-3 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
        <GripVertical size={15} />
      </button>
      <span className="text-right text-xs text-fg-3 tabular">{index + 1}</span>
      <div className="flex min-w-0 items-center gap-3">
        <AlbumArt art={track.art} seed={track.id} size={40} className="h-10 w-10" rounded="rounded-md" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-fg-0">{track.title}</div>
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
            <span className="max-w-[55%] shrink-0 truncate">{track.artist.name}</span>
            <ReasonLine reasons={track.reasons} className="hidden min-w-0 flex-1 lg:inline-flex" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Replace this song" size="sm" round onClick={onReplace} disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />}
        </IconButton>
        <IconButton label="Remove" size="sm" round onClick={onRemove}>
          <X size={15} />
        </IconButton>
      </div>
    </motion.div>
  );
}

export function StudioPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: options } = useQuery({ queryKey: ["discover-options"], queryFn: api.discoverOptions, staleTime: Infinity });
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [history, setHistory] = useState(false);
  const [count, setCount] = useState(25);
  const [familiarity, setFamiliarity] = useState(0.2);
  const [discovery, setDiscovery] = useState(0.5);
  const [energyAuto, setEnergyAuto] = useState(true);
  const [energy, setEnergy] = useState(0.5);
  const [shape, setShape] = useState<GenerateParams["shape"]>("steady");
  const [popularity, setPopularity] = useState<GenerateParams["popularity"]>("any");
  const [exclude, setExclude] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ id: string; sp_id?: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const params: GenerateParams = useMemo(
    () => ({
      seeds: [...seeds.map((s) => ({ type: s.type, value: s.value })), ...(history ? [{ type: "history", value: "1" }] : [])],
      count,
      familiarity,
      discovery,
      energy: energyAuto ? null : energy,
      shape,
      popularity,
      moods: [],
      genres: [],
      include_artists: [],
      exclude_artists: exclude.split(",").map((s) => s.trim()).filter(Boolean),
    }),
    [seeds, history, count, familiarity, discovery, energyAuto, energy, shape, popularity, exclude],
  );

  const apply = (r: GenerateResult) => {
    setResult(r);
    setTracks(r.tracks);
    setName(r.name);
    setDescription(`Made with Karasu · ${r.stats.new} new, ${r.stats.known} familiar`);
    setSaved(null);
    document.querySelector("main .scroll-area")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const run = async (regenerate = false) => {
    setLoading(true);
    try {
      apply(regenerate && result ? await api.regenerate(result.draft) : await api.generate(params));
    } catch (e) {
      toast("Couldn't generate", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const replaceAt = async (i: number) => {
    if (!result) return;
    setReplacing(i);
    try {
      const { track } = await api.replace(result.draft, i, tracks.map((t) => t.id));
      setTracks((ts) => ts.map((t, k) => (k === i ? track : t)));
    } catch (e) {
      toast("No better fit found", { description: (e as Error).message });
    } finally {
      setReplacing(null);
    }
  };

  const save = async () => {
    try {
      const body = { name: name || "Untitled", description, track_ids: tracks.map((t) => t.id), params: params as unknown as Record<string, unknown> };
      const pl = saved ? await api.updatePlaylist(saved.id, body) : await api.createPlaylist(body);
      setSaved({ id: pl.id, sp_id: saved?.sp_id });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast(`Saved “${pl.name}”`, { action: { label: "Open", onClick: () => navigate(`/playlist/${encodeURIComponent(pl.id)}`) } });
      return pl.id;
    } catch (e) {
      toast("Couldn't save", { description: (e as Error).message });
      return null;
    }
  };

  const push = async () => {
    const id = saved?.id ?? (await save());
    if (!id) return;
    try {
      const r = await api.pushPlaylist(id);
      setSaved({ id, sp_id: r.sp_id });
      toast(`In Spotify. Found ${r.matched} of ${r.total} songs`, { action: { label: "Open", onClick: () => openExternal(`https://open.spotify.com/playlist/${r.sp_id}`) } });
    } catch (e) {
      toast("Couldn't save to Spotify", { description: (e as Error).message });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = tracks.findIndex((t) => t.id === e.active.id);
    const to = tracks.findIndex((t) => t.id === e.over!.id);
    setTracks((ts) => arrayMove(ts, from, to));
  };

  const addSeed = (s: Seed) => setSeeds((list) => (list.some((x) => x.type === s.type && x.value === s.value) ? list : [...list, s].slice(-6)));
  const minutes = Math.round(tracks.reduce((a, t) => a + (t.duration_s ?? 0), 0) / 60);

  return (
    <div className="pt-4">
      <header className="mb-7">
        <h1 className="text-[34px] font-bold tracking-[-0.03em]">Playlist studio</h1>
        <p className="mt-1 text-sm text-fg-2">Start from anything. Shape the flow. Swap any song you don't love.</p>
      </header>
      <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="rounded-2xl bg-bg-2/60 p-5 hairline xl:sticky xl:top-20">
          <Field label="Start from" hint={`${seeds.length + (history ? 1 : 0)} seeds`}>
            <SeedPicker kinds={["track", "artist", "album"]} placeholder="Add a song, artist or album…" onPick={addSeed} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <AnimatePresence>
                {seeds.map((s) => (
                  <motion.span
                    key={`${s.type}:${s.value}`}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-accent-soft pl-1 pr-1.5 text-[13px] font-medium text-accent"
                  >
                    {s.art ? <AlbumArt art={s.art} seed={s.label} size={24} className="h-6 w-6" rounded="rounded-full" /> : <Sparkles size={13} className="ml-1.5" />}
                    <span className="truncate">{s.label}</span>
                    <button aria-label="Remove seed" onClick={() => setSeeds((l) => l.filter((x) => x !== s))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-accent/20">
                      <X size={12} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            {options && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <ChipPopover label="Mood" options={[...options.activities, ...options.moods]} onPick={(o) => addSeed({ type: options.activities.some((a) => a.id === o.id) ? "activity" : "mood", value: o.id, label: o.label })} />
                <ChipPopover label="Genre" options={options.genres} onPick={(o) => addSeed({ type: "genre", value: o.id, label: o.label })} />
                <ChipPopover label="Decade" options={options.decades} onPick={(o) => addSeed({ type: "decade", value: o.id, label: o.label })} />
                <ChipPopover label="Sound" options={options.instruments} onPick={(o) => addSeed({ type: "instrument", value: o.id, label: o.label })} />
              </div>
            )}
            <label className="mt-4 flex items-center justify-between gap-3 text-[13px] text-fg-1">
              <span className="flex items-center gap-2">
                <History size={15} /> Base it on my listening history
              </span>
              <Toggle checked={history} onChange={setHistory} label="Use listening history" />
            </label>
          </Field>
          <Field label="Length" hint={`${count} songs`}>
            <Slider value={count} min={10} max={100} step={5} onChange={setCount} label="Number of songs" />
          </Field>
          <Field label="Familiar ↔ New" hint={`${Math.round((1 - familiarity) * 100)}% new`}>
            <Slider value={1 - familiarity} min={0} max={1} step={0.05} onChange={(v) => setFamiliarity(1 - v)} label="Share of new songs" />
          </Field>
          <Field label="Discovery level" hint={discovery < 0.33 ? "Safe" : discovery < 0.66 ? "Balanced" : "Adventurous"}>
            <Slider value={discovery} onChange={setDiscovery} label="Discovery level" />
          </Field>
          <Field label="Energy" hint={energyAuto ? "Auto" : `${Math.round(energy * 100)}%`}>
            <div className="flex items-center gap-3">
              <Toggle checked={!energyAuto} onChange={(v) => setEnergyAuto(!v)} label="Set energy" />
              <Slider value={energy} onChange={setEnergy} label="Energy" className={cn("flex-1", energyAuto && "pointer-events-none opacity-40")} />
            </div>
          </Field>
          <Field label="Flow">
            <div className="grid grid-cols-4 gap-1.5">
              {SHAPES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setShape(s.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-xs font-medium transition-colors",
                    shape === s.value ? "bg-bg-4 text-fg-0 shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-bg-3/60 text-fg-2 hover:text-fg-0",
                  )}
                >
                  <svg viewBox="0 0 32 22" className="h-5 w-8" aria-hidden>
                    <path d={s.path} fill="none" stroke={shape === s.value ? "var(--accent)" : "currentColor"} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {s.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Popularity">
            <Segmented
              size="sm"
              value={popularity}
              onChange={setPopularity}
              options={[
                { value: "any", label: "Any" },
                { value: "underground", label: "Underground" },
                { value: "niche", label: "Niche" },
                { value: "known", label: "Known" },
              ]}
            />
          </Field>
          <Field label="Leave out artists">
            <input
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              placeholder="Comma separated"
              className="h-10 w-full rounded-lg bg-bg-3 px-3 text-sm text-fg-0 outline-none hairline placeholder:text-fg-3"
            />
          </Field>
          <Button variant="primary" size="lg" className="mt-2 w-full" icon={loading ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} disabled={loading || (!seeds.length && !history)} onClick={() => run(false)}>
            {loading ? "Generating…" : "Generate playlist"}
          </Button>
          {!seeds.length && !history && <p className="mt-2 text-center text-xs text-fg-3">Add at least one seed, or use your history.</p>}
        </aside>

        <section className="min-w-0">
          {!result ? (
            <div className="grid min-h-[520px] place-items-center rounded-2xl border border-dashed border-line-strong">
              <EmptyState icon={<Wand2 size={24} />} title="Your playlist appears here" body="Pick a song, an artist, a mood or a decade (or mix a few), then press Generate." />
            </div>
          ) : (
            <motion.div key={result.draft} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
              <div className="rounded-2xl bg-bg-2/60 p-5 hairline">
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Playlist name" className="w-full bg-transparent text-[30px] font-bold tracking-[-0.03em] text-fg-0 outline-none" />
                <input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" className="mt-1 w-full bg-transparent text-sm text-fg-2 outline-none" />
                <div className="mt-4">
                  <EnergyChart values={tracks.map((t) => t.facets.energy)} />
                  <div className="mt-1 flex justify-between text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">
                    <span>Energy flow</span>
                    <span>{tracks.length} songs · {minutes} min</span>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="primary" icon={<Play size={16} fill="currentColor" />} onClick={() => usePlayer.getState().playList(tracks, 0, { label: name || "Studio draft" })}>
                    Play
                  </Button>
                  <Button variant="secondary" icon={<RefreshCw size={16} className={loading ? "animate-spin" : undefined} />} disabled={loading} onClick={() => run(true)}>
                    Regenerate
                  </Button>
                  <Button variant="secondary" icon={<Save size={16} />} onClick={save}>
                    {saved ? "Update playlist" : "Save playlist"}
                  </Button>
                  <Button variant="ghost" icon={<UploadCloud size={16} />} onClick={push}>
                    {saved?.sp_id ? "Update in Spotify" : "Save to Spotify"}
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    {tracks.map((t, i) => (
                      <DraftRow key={t.id} track={t} index={i} busy={replacing === i} onReplace={() => replaceAt(i)} onRemove={() => setTracks((ts) => ts.filter((_, k) => k !== i))} />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </motion.div>
          )}
        </section>
      </div>
    </div>
  );
}
