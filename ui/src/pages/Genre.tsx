import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { motion } from "motion/react";
import { Play, Tags } from "lucide-react";
import { api } from "../lib/api";
import { EASE } from "../lib/motion";
import { plural } from "../lib/format";
import type { Artist } from "../lib/types";
import { usePlayer } from "../store/player";
import { ArtistCard, TrackCard } from "../components/music/Cards";
import { TrackList } from "../components/music/TrackRow";
import { Bars } from "../components/charts/Charts";
import { JobButton } from "../components/discover/JobButton";
import { DetailHero } from "../components/ui/DetailHero";
import { Button } from "../components/ui/Button";
import { Carousel, Section } from "../components/ui/Section";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";

function GenreSkeleton() {
  return (
    <div className="pt-6">
      <div className="flex flex-col gap-7 md:flex-row md:items-end">
        <Skeleton className="h-[232px] w-[232px] rounded-2xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-14 w-72 max-w-full rounded-lg" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>
      <div className="mt-12 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function GenrePage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["genre", id], queryFn: () => api.genre(id), staleTime: 300_000 });
  const [all, setAll] = useState(false);
  if (isLoading) return <GenreSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const s = data.stats;
  const href = `/explore/genre/${id}`;
  const context = { label: data.label, href };
  return (
    <div>
      <DetailHero
        arts={data.arts.length >= 4 ? data.arts : undefined}
        art={data.arts[0]}
        seed={data.label}
        eyebrow={`${data.kind === "sound" ? "Sound" : "Genre"} · ${data.family_label}`}
        title={data.label}
        meta={
          <>
            <span>{plural(s.songs, "song")}</span>
            <span className="text-fg-3">·</span>
            <span>{plural(s.artists, "artist")}</span>
            <span className="text-fg-3">·</span>
            <span>{s.new.toLocaleString()} new to you</span>
            {s.library > 0 && (
              <>
                <span className="text-fg-3">·</span>
                <span>{s.share >= 0.01 ? `${Math.round(s.share * 100)}%` : "under 1%"} of your library</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="primary"
              icon={<Play size={16} fill="currentColor" strokeWidth={0} />}
              disabled={!data.for_you.length}
              onClick={() => usePlayer.getState().playList(data.for_you, 0, context)}
            >
              Play mix
            </Button>
            <JobButton
              label="Dig deeper"
              start={() => api.deeper("genre", id)}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ["genre", id] });
                qc.invalidateQueries({ queryKey: ["explore"] });
              }}
            />
          </>
        }
      >
        {data.blurb && <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-fg-1">{data.blurb}</p>}
      </DetailHero>

      {data.related.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
          className="-mt-2 mb-10 flex flex-wrap items-center gap-1.5"
        >
          <span className="mr-1 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">{data.kind === "sound" ? "Shows up in" : "Related"}</span>
          {data.related.map((r) => (
            <Link
              key={r.id}
              to={`/explore/genre/${r.id}`}
              className="rounded-full bg-fg-0/[0.06] px-3 py-1 text-[12.5px] text-fg-1 transition-colors hover:bg-fg-0/[0.12] hover:text-fg-0"
            >
              {r.label}
            </Link>
          ))}
        </motion.div>
      )}

      <Section
        title="For you"
        subtitle="Songs you haven't heard yet, ranked by how well they fit your taste"
        action={
          data.for_you.length > 10 && (
            <button onClick={() => setAll((v) => !v)} className="rounded-md px-2 py-1 text-[13px] font-semibold text-fg-2 transition-colors hover:text-fg-0">
              {all ? "Show less" : "Show all"}
            </button>
          )
        }
      >
        {data.for_you.length ? (
          <TrackList tracks={all ? data.for_you : data.for_you.slice(0, 10)} context={context} />
        ) : (
          <EmptyState icon={<Tags size={22} />} title="Nothing new here yet" body="Dig deeper and Karasu will look for more songs like these." />
        )}
      </Section>

      {data.shelves.map((shelf) => (
        <Section key={shelf.id} title={shelf.title}>
          <Carousel>
            {shelf.tracks.map((t) => (
              <TrackCard key={t.id} track={t} list={shelf.tracks} context={{ label: `${data.label} · ${shelf.title}`, href }} />
            ))}
          </Carousel>
        </Section>
      ))}

      {data.artists.length > 0 && (
        <Section title="Artists">
          <Carousel gap={20}>
            {data.artists.map((a) => (
              <div key={a.dz_id} className="flex w-[150px] shrink-0 snap-start flex-col">
                <ArtistCard artist={{ ...a, fans: null } as Artist} width={150} />
                <div className="mt-0.5 text-center text-xs text-fg-3">{a.known ? "In your library" : plural(a.songs, "song")}</div>
              </div>
            ))}
          </Carousel>
        </Section>
      )}

      {data.library.length > 0 && (
        <Section title="Already in your library" subtitle={data.kind === "sound" ? "Your songs with the biggest guitar moments" : "Songs you know in this genre"}>
          <TrackList tracks={data.library} context={{ label: `${data.label} · your library`, href }} showReason={false} />
        </Section>
      )}

      {data.decades.length > 1 && (
        <Section title="Through the years">
          <div className="rounded-2xl bg-bg-2/50 p-5 hairline">
            <Bars values={data.decades.map((d) => d.count)} labels={data.decades.map((d) => `${d.decade}s`)} height={120} format={(v) => `${v} songs`} />
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
      )}

      <p className="text-xs leading-relaxed text-fg-3">
        {data.source
          ? `Genres come from MusicBrainz tags. ${Math.round(data.source.tagged * 100)}% of these songs are tagged there; the rest were matched by how they sound.`
          : "Found by listening: Karasu estimates riffs and solos from each song's 30-second preview, so expect the odd miss."}
      </p>
    </div>
  );
}
