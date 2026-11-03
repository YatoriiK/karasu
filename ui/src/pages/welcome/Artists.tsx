import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import type { Artist, SetupState } from "../../lib/types";
import { AlbumArt } from "../../components/music/AlbumArt";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/states";
import { cn } from "../../components/ui/cn";
import { JobProgress, Nav, StepTitle } from "./ui";

const MIN = 3;

function useDebounced<T>(value: T, ms: number) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

function Tile({ artist, on, onToggle }: { artist: Artist; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-pressed={on} className="group min-w-0 text-center" data-artist={artist.dz_id}>
      <div className="relative">
        <AlbumArt
          art={artist.art}
          seed={artist.name}
          size={120}
          rounded="rounded-full"
          className={cn("aspect-square w-full transition-[filter,opacity] duration-200", on ? "opacity-60" : "group-hover:brightness-110")}
        />
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className="absolute inset-0 grid place-items-center"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-fg-0 text-bg-0 shadow-lg">
                <Check size={20} />
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className={cn("mt-2 truncate text-[13px] font-medium", on ? "text-fg-0" : "text-fg-1")}>{artist.name}</div>
    </button>
  );
}

export function ArtistsStep({ setup, onNext, onBack }: { setup: SetupState; onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Artist[]>(setup.picks);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(setup.path === "free" && !!setup.job);
  const query = useDebounced(text.trim(), 300);
  const { data: found, isFetching, error } = useQuery({
    queryKey: ["setup-artists", query],
    queryFn: ({ signal }) => api.setupArtists(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const chosen = new Set(picked.map((a) => a.dz_id));
  const toggle = (artist: Artist) => {
    setSent(false);
    setPicked((list) => (list.some((a) => a.dz_id === artist.dz_id) ? list.filter((a) => a.dz_id !== artist.dz_id) : [...list, artist].slice(0, 30)));
  };
  const same = sent && picked.length === setup.picks.length && picked.every((a, i) => setup.picks[i]?.dz_id === a.dz_id);

  const learn = async () => {
    setBusy(true);
    try {
      await api.setupPicks(picked.map((a) => a.dz_id));
      await qc.invalidateQueries({ queryKey: ["setup"] });
      setSent(true);
    } catch (e) {
      toast("Couldn't save your artists", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepTitle
        kicker="Your taste · step 1 of 2"
        title="Pick artists you love"
        lead={`Pick at least ${MIN}; more makes Karasu's first guesses better. It listens to their songs to learn what you like, then keeps learning from everything you like and skip.`}
      />
      <div className="mt-8 flex h-11 items-center gap-2.5 rounded-xl bg-bg-2 px-3.5 hairline focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
        {isFetching ? <Loader2 size={16} className="animate-spin text-fg-3" /> : <Search size={16} className="text-fg-3" />}
        <input
          aria-label="Search artists"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search for an artist"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg-0 outline-none placeholder:text-fg-3"
        />
        {text && (
          <button aria-label="Clear" onClick={() => setText("")} className="text-fg-3 hover:text-fg-0">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-3">{query ? `Results for “${query}”` : "Popular right now"}</div>
      {error ? (
        <p className="mt-3 text-[13.5px] text-bad">{(error as Error).message}</p>
      ) : !found ? (
        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-square w-full rounded-full" />
              <Skeleton className="mx-auto mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : found.length ? (
        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-6" data-artist-grid>
          {found.map((a) => (
            <Tile key={a.dz_id} artist={a} on={chosen.has(a.dz_id)} onToggle={() => toggle(a)} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13.5px] text-fg-2">No artists found. Try another spelling.</p>
      )}

      <div className="sticky bottom-0 z-10 -mx-2 mt-8 rounded-2xl bg-bg-2/95 p-4 backdrop-blur hairline" data-picked>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-fg-1">
              {picked.length < MIN ? `${picked.length} picked · ${MIN - picked.length} more to go` : `${picked.length} picked`}
            </div>
            {picked.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {picked.map((a) => (
                  <button
                    key={a.dz_id}
                    onClick={() => toggle(a)}
                    className="flex items-center gap-1.5 rounded-full bg-bg-3 py-1 pl-1 pr-2.5 text-[12.5px] text-fg-0 hover:bg-bg-4"
                    title={`Remove ${a.name}`}
                  >
                    <AlbumArt art={a.art} seed={a.name} size={20} rounded="rounded-full" className="h-5 w-5" />
                    {a.name}
                    <X size={12} className="text-fg-3" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="primary"
            onClick={learn}
            disabled={busy || picked.length < MIN || same}
            icon={busy ? <Loader2 size={15} className="animate-spin" /> : same ? <Check size={15} /> : undefined}
          >
            {same ? "Saved" : "Learn my taste"}
          </Button>
        </div>
        {sent && setup.job && (
          <div className="mt-4">
            <JobProgress job={setup.job} note="You can keep going. This finishes in the background." />
          </div>
        )}
      </div>

      <Nav
        back={onBack}
        next={
          <Button variant={sent ? "primary" : "ghost"} onClick={onNext} disabled={!sent}>
            Continue <ArrowRight size={15} />
          </Button>
        }
      />
    </div>
  );
}
