import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Play } from "lucide-react";
import { get } from "../lib/api";
import { compact, duration } from "../lib/format";
import type { Art, Track } from "../lib/types";
import { usePlayer } from "../store/player";
import { TrackList } from "../components/music/TrackRow";
import { Button } from "../components/ui/Button";
import { DetailHero } from "../components/ui/DetailHero";
import { ErrorState, Skeleton } from "../components/ui/states";

type AlbumData = {
  album: {
    dz_id: number;
    title: string;
    artist: string;
    artist_id: number | null;
    label: string | null;
    year: string | null;
    type: string | null;
    fans: number | null;
    duration_s: number | null;
    genres: string[];
    art: Art | null;
  };
  tracks: Track[];
};

export function AlbumPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["album", id], queryFn: () => get<AlbumData>(`/api/albums/${id}`) });
  if (isLoading)
    return (
      <div className="flex items-end gap-7 pt-6">
        <Skeleton className="h-[232px] w-[232px] rounded-2xl" />
        <div className="flex-1 space-y-4">
          <Skeleton className="h-16 w-1/2 rounded-lg" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
    );
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const al = data.album;
  const palette = data.tracks.find((t) => t.art?.palette)?.art?.palette;
  const context = { label: al.title, href: `/album/${id}` };
  return (
    <div>
      <DetailHero
        art={al.art}
        palette={palette}
        seed={al.title}
        eyebrow={al.type ?? "Album"}
        title={al.title}
        meta={
          <>
            {al.artist_id ? (
              <Link to={`/artist/${al.artist_id}`} className="font-semibold text-fg-0 hover:underline">
                {al.artist}
              </Link>
            ) : (
              <span className="font-semibold">{al.artist}</span>
            )}
            {al.year && <span className="text-fg-2">· {al.year}</span>}
            <span className="text-fg-2">· {data.tracks.length} songs</span>
            {al.duration_s && <span className="text-fg-3">· {duration(al.duration_s)}</span>}
            {al.label && <span className="text-fg-3">· {al.label}</span>}
            {al.fans != null && <span className="text-fg-3">· {compact(al.fans)} fans</span>}
          </>
        }
        actions={
          <Button variant="primary" size="lg" icon={<Play size={18} fill="currentColor" />} disabled={!data.tracks.length} onClick={() => usePlayer.getState().playList(data.tracks, 0, context)}>
            Play
          </Button>
        }
      />
      <TrackList tracks={data.tracks} context={context} showAlbum={false} showReason={false} />
    </div>
  );
}
