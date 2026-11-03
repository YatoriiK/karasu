import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { ExternalLink, ListMusic, ListPlus, Play, Shuffle, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { openExternal } from "../lib/tauri";
import { usePlayer } from "../store/player";
import { TrackList, TrackRow } from "../components/music/TrackRow";
import { VirtualList } from "../components/ui/VirtualList";
import { PlaylistEditContext } from "../components/music/playlistEdit";
import type { PlaylistDetail, Track } from "../lib/types";
import { Button } from "../components/ui/Button";
import { DetailHero } from "../components/ui/DetailHero";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";

export function PlaylistPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pushing, setPushing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["playlist", id], queryFn: () => api.playlist(id) });
  if (isLoading)
    return (
      <div className="pt-6">
        <div className="flex items-end gap-7">
          <Skeleton className="h-[232px] w-[232px] rounded-xl" />
          <div className="flex-1 space-y-4">
            <Skeleton className="h-14 w-2/3 rounded-lg" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <div className="mt-10 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    );
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const tracks = data.tracks;
  const minutes = Math.round(tracks.reduce((s, t) => s + (t.duration_s ?? 0), 0) / 60);
  const context = { label: data.name, href: `/playlist/${encodeURIComponent(id)}`, spotify: data.kind === "spotify" ? data.id : undefined };
  const editable = data.editable && (data.kind === "spotify" || data.kind === "playlist");
  const remove = async (track: Track) => {
    try {
      await api.removeFromPlaylist(id, [track.id]);
      qc.setQueryData<PlaylistDetail>(["playlist", id], (old) => (old ? { ...old, tracks: old.tracks.filter((t) => t.id !== track.id) } : old));
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast(`Removed from ${data.name}`, { description: `${track.artist.name} – ${track.title}` });
    } catch (e) {
      toast("Couldn't remove that song", { description: (e as Error).message });
    }
  };
  const spotifyUrl = data.sp_id ? `https://open.spotify.com/playlist/${data.sp_id}` : null;
  const push = async () => {
    setPushing(true);
    try {
      const res = await api.pushPlaylist(id);
      toast(`Saved to Spotify. Found ${res.matched} of ${res.total} songs`, {
        action: { label: "Open", onClick: () => openExternal(`https://open.spotify.com/playlist/${res.sp_id}`) },
      });
      qc.invalidateQueries({ queryKey: ["playlist", id] });
    } catch (e) {
      toast("Couldn't save to Spotify", { description: (e as Error).message });
    } finally {
      setPushing(false);
    }
  };
  return (
    <div>
      <DetailHero
        arts={data.art?.length ? data.art : tracks.slice(0, 4).map((t) => t.art)}
        palette={tracks[0]?.art?.palette}
        eyebrow={
          data.kind === "lane"
            ? "Karasu playlist"
            : data.kind === "daily"
              ? "Made for you today"
              : data.kind === "spotify"
                ? data.editable
                  ? "Your Spotify playlist"
                  : `Spotify playlist · by ${data.owner ?? "someone"}`
                : "Your playlist"
        }
        title={data.name}
        meta={
          <>
            {data.description && <span className="text-fg-2">{data.description}</span>}
            <span className="text-fg-3">·</span>
            <span>{tracks.length} songs</span>
            {minutes > 0 && <span className="text-fg-3">· about {minutes} min</span>}
          </>
        }
        actions={
          <>
            <Button variant="primary" size="lg" icon={<Play size={18} fill="currentColor" />} disabled={!tracks.length} onClick={() => usePlayer.getState().playList(tracks, 0, context)}>
              Play
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={<Shuffle size={17} />}
              disabled={!tracks.length}
              onClick={() => {
                const s = usePlayer.getState();
                if (!s.shuffle) s.toggleShuffle();
                s.playList(tracks, Math.floor(Math.random() * tracks.length), context);
              }}
            >
              Shuffle
            </Button>
            {spotifyUrl && (
              <Button variant="ghost" size="lg" icon={<ExternalLink size={17} />} onClick={() => openExternal(spotifyUrl)}>
                Open in Spotify
              </Button>
            )}
            {data.kind === "daily" && (
              <Button
                variant="ghost"
                size="lg"
                icon={<ListPlus size={17} />}
                disabled={!tracks.length}
                onClick={async () => {
                  const day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  const pl = await api.createPlaylist({ name: `Daily Mix · ${day}`, description: "Saved from Karasu's Daily Mix", track_ids: tracks.map((t) => t.id) });
                  qc.invalidateQueries({ queryKey: ["playlists"] });
                  toast("Saved a copy to your playlists");
                  navigate(`/playlist/${encodeURIComponent(pl.id)}`);
                }}
              >
                Save a copy
              </Button>
            )}
            {data.kind === "playlist" && (
              <Button variant="ghost" size="lg" icon={<UploadCloud size={17} />} disabled={pushing || !tracks.length} onClick={push}>
                {pushing ? "Saving…" : data.sp_id ? "Update in Spotify" : "Save to Spotify"}
              </Button>
            )}
            {data.kind === "playlist" && (
              <Button
                variant="ghost"
                size="lg"
                icon={<Trash2 size={17} />}
                onClick={async () => {
                  await api.deletePlaylist(id);
                  qc.invalidateQueries({ queryKey: ["playlists"] });
                  toast(`Deleted ${data.name}`);
                  navigate("/playlists");
                }}
              >
                Delete
              </Button>
            )}
          </>
        }
      />
      {data.blocked ? (
        <EmptyState
          icon={<ListMusic size={22} />}
          title="Spotify keeps this one to itself"
          body="Spotify doesn't let other apps open its own playlists, like Discover Weekly or Daily Mixes. You can still play it in the Spotify app."
        />
      ) : tracks.length ? (
        <PlaylistEditContext.Provider value={editable ? { remove } : null}>
          {tracks.length > 120 ? (
            <VirtualList
              items={tracks}
              estimate={() => 56}
              getKey={(t, i) => `${t.id}:${i}`}
              render={(t, i) => <TrackRow track={t} index={i} list={tracks} context={context} animate={false} />}
            />
          ) : (
            <TrackList tracks={tracks} context={context} />
          )}
        </PlaylistEditContext.Provider>
      ) : (
        <EmptyState icon={<ListMusic size={22} />} title="This playlist is empty" body="Add songs from anywhere with the ••• menu." />
      )}
    </div>
  );
}
