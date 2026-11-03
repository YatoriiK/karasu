import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "../components/ui/controls";
import { useParams } from "react-router";
import { ExternalLink, ListPlus, MoreHorizontal, Pause, Play, Radar } from "lucide-react";
import { api } from "../lib/api";
import { compact, duration, tierLabel } from "../lib/format";
import { currentTrack, usePlayable, usePlayer } from "../store/player";
import { LikeButton } from "../components/music/LikeButton";
import { ReasonList } from "../components/music/Reasons";
import { TrackContextMenu, TrackMenu } from "../components/music/TrackMenu";
import { TrackList } from "../components/music/TrackRow";
import { useTrackActions } from "../components/music/useTrackActions";
import { Button } from "../components/ui/Button";
import { DetailHero } from "../components/ui/DetailHero";
import { Section } from "../components/ui/Section";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";

export function TrackPage() {
  const canPlay = usePlayable();
  const full = usePlayer((s) => s.source === "spotify");
  const { id = "" } = useParams();
  const actions = useTrackActions();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["track", id], queryFn: () => api.track(id) });
  const [aspect, setAspect] = useState("overall");
  const aspectQuery = useQuery({
    queryKey: ["discover", "similar", id, aspect],
    queryFn: () => api.discover("similar", { seed: id, aspect, limit: 20 }),
    enabled: aspect !== "overall" && !!data?.track.dz_id,
  });
  const similar = aspect === "overall" ? data?.similar ?? [] : aspectQuery.data?.items ?? [];
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  if (isLoading)
    return (
      <div className="flex items-end gap-7 pt-6">
        <Skeleton className="h-[232px] w-[232px] rounded-2xl" />
        <div className="flex-1 space-y-4">
          <Skeleton className="h-14 w-2/3 rounded-lg" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    );
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const t = data.track;
  const list = [t, ...similar];
  const chips = [...t.facets.top, ...t.facets.genres];
  return (
    <div>
      <TrackContextMenu track={t}>
        <div>
          <DetailHero
            art={t.art}
            palette={t.art?.palette}
            seed={t.id}
            eyebrow="Song"
            title={t.title}
            meta={
              <>
                <button onClick={() => actions.goArtist(t)} className="font-semibold text-fg-0 hover:underline">
                  {t.artist.name}
                </button>
                {t.album.title && <span className="text-fg-2">· {t.album.title}</span>}
                {t.year && <span className="text-fg-2">· {t.year}</span>}
                {t.duration_s && <span className="text-fg-3">· {duration(t.duration_s)}</span>}
                {t.facets.tempo && <span className="text-fg-3">· ~{Math.round(t.facets.tempo)} BPM</span>}
                {t.popularity.tier && (
                  <span className="text-fg-3">
                    · {tierLabel[t.popularity.tier]} ({compact(t.popularity.fans)} fans)
                  </span>
                )}
              </>
            }
            actions={
              <>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!canPlay(t)}
                  icon={playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                  onClick={() => (isCurrent ? usePlayer.getState().toggle() : actions.play(t, list, { label: t.title }))}
                >
                  {canPlay(t) ? (playing ? "Pause" : full ? "Play" : "Play preview") : "No preview"}
                </Button>
                <LikeButton track={t} size={20} className="h-12 w-12 bg-bg-3 hover:bg-bg-4" />
                <Button variant="secondary" size="lg" icon={<ListPlus size={18} />} onClick={() => actions.addToPlaylist([t])}>
                  Add to playlist
                </Button>
                <Button variant="ghost" size="lg" icon={<ExternalLink size={17} />} onClick={() => actions.openSpotify(t)}>
                  {t.sp_id ? "Open in Spotify" : "Find in Spotify"}
                </Button>
                <TrackMenu
                  track={t}
                  trigger={
                    <button aria-label="More" className="grid h-12 w-12 place-items-center rounded-full text-fg-1 transition-colors hover:bg-bg-3 hover:text-fg-0">
                      <MoreHorizontal size={20} />
                    </button>
                  }
                />
              </>
            }
          >
            {(t.reasons.length > 0 || chips.length > 0) && (
              <div className="mt-5 space-y-3">
                <ReasonList reasons={t.reasons} />
                {chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <span key={c} className="rounded-full bg-bg-3 px-2.5 py-1 text-xs font-medium text-fg-1 hairline">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DetailHero>
        </div>
      </TrackContextMenu>
      <Section
        title="Similar sounds"
        subtitle={aspect === "overall" ? "Ranked by how close they sound, from artists you don't know yet" : "Approximate — estimated from 30-second previews"}
        action={
          t.dz_id ? (
            <Segmented
              size="sm"
              value={aspect}
              onChange={setAspect}
              options={[
                { value: "overall", label: "Overall" },
                { value: "guitar", label: "Guitar" },
                { value: "drums", label: "Drums" },
                { value: "vocals", label: "Vocals" },
                { value: "atmosphere", label: "Atmosphere" },
              ]}
            />
          ) : undefined
        }
      >
        {similar.length ? (
          <TrackList tracks={similar} context={{ label: `Similar to ${t.title}` }} />
        ) : (
          <EmptyState icon={<Radar size={22} />} title="No close matches yet" body="Karasu hasn't listened to this song yet. Open Discover → Similar Sounds to analyze it." />
        )}
      </Section>
    </div>
  );
}
