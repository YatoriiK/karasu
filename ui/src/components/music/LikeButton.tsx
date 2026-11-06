import { AnimatePresence, motion } from "motion/react";
import { Heart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useConnect } from "../../store/connect";
import type { Track } from "../../lib/types";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/Tooltip";
import { useTrackActions } from "./useTrackActions";
import { Skin } from "../../theme/skins";

// The player holds its own copy of each song, which can go stale (or never knew), so ask the engine.
export function useLiked(track: Track, live: boolean) {
  const linked = useConnect((s) => {
    const now = s.state?.track;
    return now && (track.sp_id === now.sp_id || track.id === `sp:${now.sp_id}`) ? (now.linked_id ?? null) : null;
  });
  const q = useQuery({
    queryKey: ["liked", track.id],
    queryFn: async () => Object.values(await api.liked(linked ? [track.id, `sp:${linked}`] : [track.id])).some(Boolean),
    enabled: live,
    staleTime: 20_000,
  });
  return live && q.data !== undefined ? q.data : track.state.liked || track.state.saved;
}

export function LikeButton({ track, size = 18, className, live = false }: { track: Track; size?: number; className?: string; live?: boolean }) {
  const actions = useTrackActions();
  const liked = useLiked(track, live);
  return (
    <Tooltip label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}>
      <motion.button
        aria-label={liked ? "Unlike" : "Like"}
        aria-pressed={liked}
        onClick={(e) => {
          e.stopPropagation();
          actions.like(track, liked);
        }}
        whileTap={{ scale: 0.82 }}
        className={cn(
          "relative grid h-8 w-8 place-items-center rounded-full transition-colors",
          liked ? "text-accent" : "text-fg-2 hover:text-fg-0",
          className,
        )}
      >
        <motion.span
          key={liked ? "on" : "off"}
          initial={liked ? { scale: 0.4 } : false}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 14 }}
          className="grid place-items-center"
        >
          <Skin slot="player.like" size={size} className={liked ? "" : "opacity-60"}>
            <Heart size={size} fill={liked ? "currentColor" : "none"} strokeWidth={liked ? 0 : 1.8} />
          </Skin>
        </motion.span>
        <AnimatePresence>
          {liked && (
            <motion.span
              key="burst"
              initial={{ scale: 0.3, opacity: 0.7 }}
              animate={{ scale: 1.9, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none absolute inset-1 rounded-full border-2 border-accent"
            />
          )}
        </AnimatePresence>
      </motion.button>
    </Tooltip>
  );
}
