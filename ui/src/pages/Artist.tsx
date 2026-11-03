import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { motion } from "motion/react";
import { ExternalLink, Play } from "lucide-react";
import { get } from "../lib/api";
import { compact, tierLabel } from "../lib/format";
import type { Artist, Art, Track } from "../lib/types";
import { openExternal } from "../lib/tauri";
import { usePlayer } from "../store/player";
import { AlbumArt } from "../components/music/AlbumArt";
import { ArtistCard } from "../components/music/Cards";
import { TrackList } from "../components/music/TrackRow";
import { Button } from "../components/ui/Button";
import { DetailHero } from "../components/ui/DetailHero";
import { Carousel, Section } from "../components/ui/Section";
import { ErrorState, Skeleton } from "../components/ui/states";

type ArtistData = {
  artist: Artist;
  in_library: boolean;
  library_tracks: Track[];
  top: Track[];
  related: Artist[];
  albums: { dz_id: number; title: string; year: string | null; type: string; art: Art | null }[];
};

export function ArtistPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["artist", id],
    queryFn: () => get<ArtistData>(`/api/artists/${id}`),
  });
  if (isLoading)
    return (
      <div className="flex items-end gap-7 pt-6">
        <Skeleton className="h-[232px] w-[232px] rounded-full" />
        <div className="flex-1 space-y-4">
          <Skeleton className="h-16 w-1/2 rounded-lg" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
    );
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const a = data.artist;
  const context = { label: a.name, href: `/artist/${id}` };
  return (
    <div>
      <DetailHero
        art={a.art}
        palette={a.art?.palette ?? data.top[0]?.art?.palette}
        round
        seed={a.name}
        eyebrow={data.in_library ? "Artist · in your library" : "Artist"}
        title={a.name}
        meta={
          <>
            {a.tier && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">{tierLabel[a.tier]}</span>}
            {a.fans != null && <span>{compact(a.fans)} fans on Deezer</span>}
            {a.first_year && <span className="text-fg-2">· active since {a.first_year}</span>}
          </>
        }
        actions={
          <>
            <Button variant="primary" size="lg" icon={<Play size={18} fill="currentColor" />} disabled={!data.top.length} onClick={() => usePlayer.getState().playList(data.top, 0, context)}>
              Play
            </Button>
            <Button variant="ghost" size="lg" icon={<ExternalLink size={17} />} onClick={() => openExternal(`https://open.spotify.com/search/${encodeURIComponent(a.name)}/artists`)}>
              Find in Spotify
            </Button>
          </>
        }
      />
      {data.top.length > 0 && (
        <Section title="Popular">
          <TrackList tracks={data.top.slice(0, 10)} context={context} showReason={false} />
        </Section>
      )}
      {data.albums.length > 0 && (
        <Section title="Discography">
          <Carousel>
            {data.albums.map((al) => (
              <Link key={al.dz_id} to={`/album/${al.dz_id}`} className="group w-[168px] shrink-0 snap-start">
                <motion.div whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
                  <AlbumArt art={al.art} seed={al.title} size={168} className="aspect-square w-full shadow-[0_14px_34px_-18px_rgb(0_0_0/0.85)]" rounded="rounded-xl" />
                </motion.div>
                <div className="mt-2.5 truncate text-[14px] font-semibold">{al.title}</div>
                <div className="truncate text-[13px] capitalize text-fg-2">
                  {al.year} · {al.type}
                </div>
              </Link>
            ))}
          </Carousel>
        </Section>
      )}
      {data.library_tracks.length > 0 && (
        <Section title="In your library">
          <TrackList tracks={data.library_tracks} context={context} showReason={false} />
        </Section>
      )}
      {data.related.length > 0 && (
        <Section title="Fans also like" subtitle="From Deezer's related artists">
          <Carousel gap={20}>
            {data.related.map((r) => (
              <ArtistCard key={r.dz_id} artist={r} />
            ))}
          </Carousel>
        </Section>
      )}
    </div>
  );
}
