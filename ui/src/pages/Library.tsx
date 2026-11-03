import { useCallback, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Library, ListMusic, Play, RefreshCw, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { usePlayer } from "../store/player";
import { PlaylistCard } from "../components/music/Cards";
import { TrackRow } from "../components/music/TrackRow";
import { VirtualList } from "../components/ui/VirtualList";
import { Button } from "../components/ui/Button";
import { Segmented } from "../components/ui/controls";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";

const TABS = [
  { value: "saved", label: "Liked Songs", empty: "Songs you like in Spotify or here show up in this list." },
  { value: "playlists", label: "Playlists", empty: "Your Spotify playlists show up here after the first sync." },
  { value: "top", label: "Your top", empty: "Your Spotify top tracks appear after a sync." },
  { value: "recent", label: "Recently played", empty: "Play something and it shows up here." },
] as const;

type Kind = (typeof TABS)[number]["value"];

function Playlists() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["playlists"], queryFn: api.playlists, staleTime: 60_000 });
  if (isLoading)
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-xl" />
        ))}
      </div>
    );
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data?.length) return <EmptyState icon={<ListMusic size={22} />} title="No playlists yet" body={TABS[1].empty} />;
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
      {data.map((p) => (
        <PlaylistCard key={p.id} playlist={p} arts={p.art ?? []} fluid />
      ))}
    </div>
  );
}

function Songs({ kind }: { kind: Exclude<Kind, "playlists"> }) {
  const tab = TABS.find((t) => t.value === kind)!;
  const q = useInfiniteQuery({
    queryKey: ["library", kind],
    queryFn: ({ pageParam }) => api.library(kind, pageParam, 80),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  const more = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const context = { label: tab.label, href: "/library" };
  if (q.isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!items.length) return <EmptyState icon={kind === "saved" ? <Heart size={22} /> : <Library size={22} />} title="Nothing here yet" body={tab.empty} />;
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="primary" icon={<Play size={16} fill="currentColor" />} onClick={() => usePlayer.getState().playList(items, 0, context)}>
          Play
        </Button>
        <Button
          icon={<Shuffle size={16} />}
          onClick={() => {
            const s = usePlayer.getState();
            if (!s.shuffle) s.toggleShuffle();
            s.playList(items, Math.floor(Math.random() * items.length), context);
          }}
        >
          Shuffle
        </Button>
      </div>
      <VirtualList
        key={kind}
        items={items}
        estimate={() => 56}
        getKey={(t) => t.id}
        onEnd={more}
        render={(t, i) => <TrackRow track={t} index={i} list={items} context={context} showReason={false} animate={false} />}
      />
      {q.isFetchingNextPage && <Skeleton className="mt-1 h-14 rounded-lg" />}
    </>
  );
}

export function LibraryPage() {
  const [kind, setKind] = useState<Kind>("saved");
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const counts = useQuery({ queryKey: ["library", "saved", "count"], queryFn: () => api.library("saved", 0, 1), staleTime: 60_000 });
  const lists = useQuery({ queryKey: ["playlists"], queryFn: api.playlists, staleTime: 60_000 });
  const sub =
    kind === "playlists"
      ? lists.data
        ? `${lists.data.length} playlists`
        : " "
      : kind === "saved" && counts.data
        ? `${counts.data.total.toLocaleString()} liked songs`
        : " ";
  return (
    <div className="pt-4">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-[-0.03em]">Your Library</h1>
          <p className="mt-1 text-sm text-fg-2">{sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={kind} onChange={setKind} options={TABS.map((t) => ({ value: t.value, label: t.label }))} />
          <Button
            variant="ghost"
            icon={<RefreshCw size={15} className={syncing ? "animate-spin" : ""} />}
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              try {
                const res = await api.syncLibrary();
                if (!res.job) toast("Spotify isn't connected yet", { description: "Connect it in Settings → Connections." });
                else toast("Syncing with Spotify", { description: "Your liked songs and playlists update in a moment." });
                window.setTimeout(() => {
                  qc.invalidateQueries({ queryKey: ["playlists"] });
                  qc.invalidateQueries({ queryKey: ["library"] });
                  setSyncing(false);
                }, 6000);
              } catch (error) {
                setSyncing(false);
                toast("Couldn't sync", { description: (error as Error).message });
              }
            }}
          >
            Sync
          </Button>
        </div>
      </div>
      {kind === "playlists" ? <Playlists /> : <Songs key={kind} kind={kind} />}
    </div>
  );
}
