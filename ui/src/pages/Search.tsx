import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { motion } from "motion/react";
import { Search as SearchIcon, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { EASE } from "../lib/motion";
import { currentTrack, usePlayable, usePlayer } from "../store/player";
import { AlbumArt } from "../components/music/AlbumArt";
import { ArtistCard, PlayFab } from "../components/music/Cards";
import { TrackList } from "../components/music/TrackRow";
import { useTrackActions } from "../components/music/useTrackActions";
import { Carousel, Section } from "../components/ui/Section";
import { Segmented } from "../components/ui/controls";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";
import { Link } from "react-router";
import type { Track } from "../lib/types";

function TopResult({ item, kind, list }: { item: any; kind: "artist" | "track"; list: Track[] }) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => kind === "track" && currentTrack(s)?.id === item.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="group relative flex min-h-[220px] flex-1 flex-col justify-end gap-5 overflow-hidden rounded-2xl bg-bg-2/80 p-5 hairline transition-colors hover:bg-bg-3"
    >
      <AlbumArt art={item.art} seed={item.name ?? item.title} size={104} className="h-[104px] w-[104px] shadow-xl" rounded={kind === "artist" ? "rounded-full" : "rounded-xl"} />
      <div>
        {kind === "artist" ? (
          <Link to={`/artist/${item.dz_id}`} className="text-[30px] font-bold tracking-[-0.03em] hover:underline">
            {item.name}
          </Link>
        ) : (
          <button onClick={() => actions.goTrack(item)} className="text-left text-[30px] font-bold tracking-[-0.03em] hover:underline">
            {item.title}
          </button>
        )}
        <div className="mt-1 text-sm text-fg-2">{kind === "artist" ? "Artist" : `Song · ${item.artist.name}`}</div>
      </div>
      {kind === "track" && canPlay(item) && (
        <div className="absolute bottom-5 right-5 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <PlayFab playing={playing} size={50} onClick={() => (isCurrent ? toggle() : actions.play(item, list, { label: "Search" }))} />
        </div>
      )}
    </motion.div>
  );
}

function VibeResults({ q }: { q: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["vibe", q], queryFn: () => api.vibe(q, 40), staleTime: 300_000 });
  if (isLoading)
    return (
      <div className="space-y-2">
        <p className="mb-4 flex items-center gap-2 text-sm text-fg-2">
          <Sparkles size={15} className="animate-pulse text-accent" /> Listening for “{q}”… the first vibe search loads the audio model.
        </p>
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data?.results.length) return <EmptyState icon={<Sparkles size={22} />} title="Nothing sounds like that yet" body="The more Karasu listens to, the better vibe search gets." />;
  return <TrackList tracks={data.results} context={{ label: `Sounds like “${q}”` }} />;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const vibe = params.get("vibe") === "1";
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: !!q && !vibe,
    staleTime: 300_000,
  });
  if (!q)
    return <EmptyState icon={<SearchIcon size={22} />} title="Search for anything" body="Press Ctrl K anywhere to search songs, artists and albums, or describe a sound." />;
  return (
    <div className="pt-4">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[32px] font-bold tracking-[-0.03em]">
          {vibe ? "Sounds like" : "Results for"} <span className="text-fg-1">“{q}”</span>
        </h1>
        <Segmented
          value={vibe ? "vibe" : "all"}
          onChange={(v) => setParams(v === "vibe" ? { q, vibe: "1" } : { q })}
          options={[
            { value: "all", label: "Everything" },
            { value: "vibe", label: (<span className="flex items-center gap-1.5"><Sparkles size={13} /> Vibe</span>) },
          ]}
        />
      </div>
      {vibe ? (
        <VibeResults q={q} />
      ) : isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Skeleton className="h-[260px] rounded-2xl" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || (!data.tracks.length && !data.artists.length && !data.albums.length) ? (
        <EmptyState icon={<SearchIcon size={22} />} title={`No results for “${q}”`} body="Check the spelling, or try describing the sound instead." />
      ) : (
        <>
          <div className="mb-11 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {data.top && (
              <section className="flex flex-col">
                <h2 className="mb-3 text-xl font-semibold">Top result</h2>
                <TopResult item={data.top.item} kind={data.top.kind} list={data.tracks} />
              </section>
            )}
            <section className="min-w-0">
              <h2 className="mb-3 text-xl font-semibold">Songs</h2>
              <TrackList tracks={data.tracks.slice(0, 5)} showAlbum={false} showReason={false} compact numbered={false} context={{ label: `Search “${q}”` }} />
            </section>
          </div>
          {data.artists.length > 0 && (
            <Section title="Artists">
              <Carousel gap={20}>
                {data.artists.map((a) => (
                  <ArtistCard key={a.dz_id} artist={a} />
                ))}
              </Carousel>
            </Section>
          )}
          {data.albums.length > 0 && (
            <Section title="Albums">
              <Carousel>
                {data.albums.map((al) => (
                  <Link key={al.dz_id} to={`/album/${al.dz_id}`} className="group w-[176px] shrink-0 snap-start">
                    <motion.div whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                      <AlbumArt art={al.art} seed={al.title} size={176} className="aspect-square w-full shadow-[0_14px_34px_-18px_rgb(0_0_0/0.85)]" rounded="rounded-xl" />
                    </motion.div>
                    <div className="mt-2.5 truncate text-[14px] font-semibold">{al.title}</div>
                    <div className="truncate text-[13px] text-fg-2">{al.artist}</div>
                  </Link>
                ))}
              </Carousel>
            </Section>
          )}
          {data.tracks.length > 5 && (
            <Section title="More songs">
              <TrackList tracks={data.tracks.slice(5)} context={{ label: `Search “${q}”` }} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
