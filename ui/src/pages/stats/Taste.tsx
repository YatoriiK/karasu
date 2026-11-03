import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Download, Share2, Users, X } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { EASE } from "../../lib/motion";
import type { Compare, Taste } from "../../lib/types";
import { ArtistCard } from "../../components/music/Cards";
import { TrackList } from "../../components/music/TrackRow";
import { HBars, Lines, ScoreRing, TraitMeter, Bars } from "../../components/charts/Charts";
import { TasteMap } from "../../components/charts/TasteMap";
import { Button, IconButton } from "../../components/ui/Button";
import { Carousel, Section } from "../../components/ui/Section";
import { EmptyState, ErrorState, Logo, Skeleton } from "../../components/ui/states";

const TRAITS: { key: keyof Taste["traits"]; label: string; left: string; right: string }[] = [
  { key: "energy", label: "Energy", left: "Calm", right: "Intense" },
  { key: "brightness", label: "Mood", left: "Dark", right: "Bright" },
  { key: "obscurity", label: "Obscurity", left: "Mainstream", right: "Underground" },
  { key: "era_range", label: "Era range", left: "One era", right: "Across decades" },
  { key: "adventurous", label: "Range", left: "Focused", right: "Everything" },
];

function download(name: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ShareCard({ data, innerRef }: { data: Taste; innerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pointer-events-none fixed -left-[2000px] top-0">
      <div ref={innerRef} className="w-[1080px] p-16 text-white" style={{ background: "linear-gradient(135deg, var(--art-glow), #121216 70%)", fontFamily: "Inter Variable, sans-serif" }}>
        <div className="flex items-center gap-3 text-2xl font-semibold text-white/80">
          <Logo size={44} /> Karasu
        </div>
        <div className="mt-16 text-[34px] font-semibold uppercase tracking-[0.16em] text-white/60">My music personality</div>
        <div className="mt-4 text-[96px] font-black leading-[0.95] tracking-[-0.04em]">{data.personality.name}</div>
        <div className="mt-8 max-w-[880px] text-[30px] leading-snug text-white/80">{data.personality.description}</div>
        <div className="mt-14 grid grid-cols-2 gap-x-14 gap-y-8">
          {TRAITS.slice(0, 4).map((t) => (
            <div key={t.key}>
              <div className="flex justify-between text-[26px] font-semibold">
                <span>{t.label}</span>
                <span className="text-white/70">{data.traits[t.key]}</span>
              </div>
              <div className="mt-3 h-4 rounded-full bg-white/15">
                <div className="h-4 rounded-full bg-white" style={{ width: `${data.traits[t.key]}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-14 text-[26px] text-white/70">Top genres: {data.genres.slice(0, 4).map((g) => g.label).join(" · ")}</div>
      </div>
    </div>
  );
}

function CompareDialog({ result, onClose }: { result: Compare | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!result} onOpenChange={(v) => !v && onClose()}>
      <AnimatePresence>
        {result && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[75] bg-[var(--scrim)] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="scroll-area fixed left-1/2 top-1/2 z-[76] max-h-[86vh] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-bg-2 p-6 elevated"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              >
                <div className="flex items-start justify-between">
                  <Dialog.Title className="text-xl font-bold">You and {result.them.name}</Dialog.Title>
                  <IconButton label="Close" size="sm" round onClick={onClose}>
                    <X size={16} />
                  </IconButton>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-8">
                  <ScoreRing value={result.score} label="match" />
                  <div className="grid flex-1 grid-cols-2 gap-4">
                    {[result.you, result.them].map((p) => (
                      <div key={p.name} className="rounded-xl bg-bg-3/60 p-4">
                        <div className="text-xs text-fg-3">{p.name}</div>
                        <div className="mt-1 font-semibold">{p.personality?.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {result.shared_genres.length > 0 && <p className="mt-6 text-sm text-fg-1">You both lean into <b>{result.shared_genres.join(", ")}</b>.</p>}
                {result.shared_artists.length > 0 && <p className="mt-2 text-sm text-fg-1">Shared favorites: {result.shared_artists.join(", ")}.</p>}
                {result.both_like.length > 0 && (
                  <>
                    <h3 className="mb-2 mt-6 font-semibold">Songs you'd both like</h3>
                    <TrackList tracks={result.both_like} context={{ label: `You + ${result.them.name}` }} showAlbum={false} />
                  </>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export function TasteView() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["taste"], queryFn: api.taste, staleTime: 600_000 });
  const card = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [compare, setCompare] = useState<Compare | null>(null);
  if (isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    );
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (data.empty) return <EmptyState icon={<Users size={22} />} title="Your taste is still forming" body="Sync your Spotify library and let Karasu listen to it first." />;
  const evo = data.evolution;
  return (
    <div>
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="relative mb-10 overflow-hidden rounded-[28px] p-8 hairline">
        <div className="absolute inset-0" style={{ background: "radial-gradient(80% 120% at 0% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%), var(--bg-2)" }} />
        <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-fg-3">Your music personality</div>
            <h2 className="mt-3 text-balance text-[clamp(34px,4.5vw,58px)] font-black leading-[0.98] tracking-[-0.04em]">{data.personality.name}</h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-fg-1">{data.personality.description}</p>
            <p className="mt-3 text-xs text-fg-3">
              Built from {data.library.tracks.toLocaleString()} songs by {data.library.artists.toLocaleString()} artists in your library.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<Share2 size={16} />}
                onClick={async () => {
                  if (!card.current) return;
                  const png = await toPng(card.current, { pixelRatio: 1, cacheBust: true });
                  download("karasu-personality.png", png);
                  toast("Saved your share card");
                }}
              >
                Share card
              </Button>
              <Button
                variant="secondary"
                icon={<Download size={16} />}
                onClick={async () => {
                  const json = await api.exportTaste();
                  download("karasu-profile.json", URL.createObjectURL(new Blob([JSON.stringify(json)], { type: "application/json" })));
                  toast("Taste profile exported", { description: "Send it to a friend so they can compare with you." });
                }}
              >
                Export taste
              </Button>
              <Button variant="secondary" icon={<Users size={16} />} onClick={() => file.current?.click()}>
                Compare with a friend
              </Button>
              <input
                ref={file}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    setCompare(await api.compare(JSON.parse(await f.text())));
                  } catch (err) {
                    toast("Couldn't compare", { description: (err as Error).message });
                  }
                }}
              />
            </div>
          </div>
          <div className="space-y-5">
            {TRAITS.map((t) => (
              <TraitMeter
                key={t.key}
                label={t.label}
                value={data.traits[t.key]}
                left={t.left}
                right={t.right}
                note={t.key === "adventurous" && data.range_genres ? `${data.range_genres} genres make up most of your listening` : undefined}
              />
            ))}
          </div>
        </div>
      </motion.section>

      <Section title="Your taste map" subtitle="Songs that sound alike sit together. The labels are the main flavors of your taste.">
        <div className="rounded-2xl bg-bg-2/50 p-4 hairline">
          <TasteMap map={data.map} />
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section title="How your taste moved" subtitle="From the songs you saved each quarter">
          <div className="rounded-2xl bg-bg-2/50 p-5 hairline">
            {evo.series.length > 1 ? (
              <Lines periods={evo.series.map((s) => s.period)} series={evo.dims.map((d) => ({ label: d, values: evo.series.map((s) => s.values[d] ?? 0) }))} />
            ) : (
              <p className="text-sm text-fg-3">Save songs over a few months and your evolution appears here.</p>
            )}
          </div>
        </Section>
        <Section title="Decades">
          <div className="rounded-2xl bg-bg-2/50 p-5 hairline">
            <Bars values={data.decades.map((d) => d.count)} labels={data.decades.map((d) => `${d.decade}s`)} height={170} format={(v) => `${v} songs`} />
            <div className="mt-2 flex gap-[3px] text-center text-2xs text-fg-3">
              {data.decades.map((d) => (
                <span key={d.decade} className="flex-1 truncate">
                  {"’"}
                  {String(d.decade).slice(2)}s
                </span>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Genres you gravitate to">
          <div className="rounded-2xl bg-bg-2/50 p-5 hairline">
            <HBars items={data.genres.filter((g) => g.score > 0).slice(0, 8).map((g) => ({ label: g.label, value: Math.round(g.score * 100) }))} unit="%" />
          </div>
        </Section>
        <Section title="Moods you return to">
          <div className="rounded-2xl bg-bg-2/50 p-5 hairline">
            <HBars items={data.moods.filter((m) => m.score > 0).slice(0, 8).map((m) => ({ label: m.label, value: Math.round(m.score * 100) }))} />
          </div>
        </Section>
      </div>

      {data.favorite_artists.length > 0 && (
        <Section title="Favorite artists" subtitle="From years of your Spotify listening">
          <Carousel gap={20}>
            {data.favorite_artists.map((a) => (
              <ArtistCard key={a.name} artist={a} />
            ))}
          </Carousel>
        </Section>
      )}
      {data.discovered.length > 0 && (
        <Section title="Recently discovered" subtitle="Songs from Karasu you liked or saved">
          <TrackList tracks={data.discovered} context={{ label: "Recently discovered" }} />
        </Section>
      )}
      <Section title="All-time most played" subtitle="Your long-running favorites on Spotify">
        <TrackList tracks={data.top_tracks} context={{ label: "All-time most played" }} showReason={false} />
      </Section>
      <ShareCard data={data} innerRef={card} />
      <CompareDialog result={compare} onClose={() => setCompare(null)} />
    </div>
  );
}
