import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { History as HistoryIcon } from "lucide-react";
import { api } from "../lib/api";
import type { HistoryItem, Track } from "../lib/types";
import { AlbumArt } from "../components/music/AlbumArt";
import { TrackRow } from "../components/music/TrackRow";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";
import { VirtualList } from "../components/ui/VirtualList";
import { ImportHistoryButton } from "./Stats";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const SOURCE: Record<string, string> = { spotify: "Spotify", app: "In app", history: "History import" };

type Row = { kind: "day"; label: string } | { kind: "play"; item: HistoryItem };

export function HistoryPage() {
  const q = useInfiniteQuery({
    queryKey: ["history"],
    queryFn: ({ pageParam }) => api.history(pageParam, 120),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    let current = "";
    for (const item of items) {
      const label = dayLabel(item.played_at);
      if (label !== current) {
        out.push({ kind: "day", label });
        current = label;
      }
      out.push({ kind: "play", item });
    }
    return out;
  }, [items]);
  const queue = useMemo(() => items.flatMap((i) => (i.track ? [i.track] : [])), [items]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  const more = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="pt-4">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-[-0.03em]">History</h1>
          <p className="mt-1 text-sm text-fg-2">Everything you've played — in Spotify and here.</p>
        </div>
        <ImportHistoryButton />
      </header>
      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<HistoryIcon size={22} />} title="No plays yet" body="Plays from Spotify show up within 30 minutes. Previews you play here appear right away." />
      ) : (
        <VirtualList
          items={rows}
          estimate={(r) => (r.kind === "day" ? 52 : 48)}
          getKey={(r, i) => (r.kind === "day" ? `d:${r.label}` : `p:${r.item.played_at}:${i}`)}
          onEnd={more}
          render={(r) => (r.kind === "day" ? <h2 className="pb-2 pt-5 text-sm font-semibold text-fg-1">{r.label}</h2> : <PlayRow item={r.item} queue={queue} />)}
        />
      )}
      {q.isFetchingNextPage && <Skeleton className="mt-1 h-12 rounded-lg" />}
    </div>
  );
}

function PlayRow({ item, queue }: { item: HistoryItem; queue: Track[] }) {
  const time = new Date(item.played_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        {item.track ? (
          <TrackRow track={item.track} list={queue} context={{ label: "History", href: "/history" }} compact showReason={false} animate={false} lead={time} />
        ) : (
          <div className="flex h-12 items-center gap-2 px-1.5 sm:gap-3 sm:px-2">
            <span className="w-[46px] shrink-0 text-center text-[11px] text-fg-3 tabular sm:w-[60px] sm:text-xs">{time}</span>
            <AlbumArt art={null} seed={item.title ?? ""} size={36} className="h-9 w-9" rounded="rounded-md" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium">{item.title}</div>
              <div className="truncate text-[13px] text-fg-2">{item.artist}</div>
            </div>
          </div>
        )}
      </div>
      <span className="hidden w-24 shrink-0 text-2xs font-semibold uppercase tracking-wider text-fg-3 lg:block">{SOURCE[item.source] ?? item.source}</span>
    </div>
  );
}
