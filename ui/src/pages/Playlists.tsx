import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Link } from "react-router";
import { ListMusic, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { PlaylistCard } from "../components/music/Cards";
import { Button } from "../components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";
import { listItem, listParent } from "../lib/motion";

export function PlaylistsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["playlists"], queryFn: api.playlists });
  return (
    <div className="pt-4">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-[-0.03em]">Playlists</h1>
          <p className="mt-1 text-sm text-fg-2">Karasu's weekly picks and the playlists you've made here.</p>
        </div>
        <Link to="/studio">
          <Button variant="primary" icon={<Wand2 size={16} />}>
            Generate a playlist
          </Button>
        </Link>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-square rounded-xl" />
              <Skeleton className="mt-3 h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={<ListMusic size={22} />} title="No playlists yet" body="Generate one from a song, a mood or an era." />
      ) : (
        <motion.div variants={listParent} initial="hidden" animate="show" className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-x-6 gap-y-8">
          {data.map((p) => (
            <motion.div key={p.id} variants={listItem}>
              <PlaylistCard playlist={p} arts={p.art ?? []} fluid />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
