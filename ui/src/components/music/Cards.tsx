import { memo } from "react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router";
import { MoreHorizontal, Pause, Play } from "lucide-react";
import type { Artist, PlaylistSummary, Track, Art } from "../../lib/types";
import { compact, tierLabel } from "../../lib/format";
import { currentTrack, usePlayable, usePlayer } from "../../store/player";
import { cn } from "../ui/cn";
import { AlbumArt, Mosaic } from "./AlbumArt";
import { ReasonLine } from "./Reasons";
import { TrackContextMenu, TrackMenu } from "./TrackMenu";
import { useTrackActions } from "./useTrackActions";

export function PlayFab({
  playing,
  onClick,
  size = 44,
  className,
  label,
}: {
  playing: boolean;
  onClick: () => void;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <motion.button
      aria-label={label ?? (playing ? "Pause" : "Play")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 600, damping: 26 }}
      style={{ width: size, height: size }}
      className={cn(
        "grid place-items-center rounded-full bg-accent text-accent-fg shadow-[0_10px_28px_-8px_rgb(0_0_0/0.7)]",
        className,
      )}
    >
      {playing ? (
        <Pause size={size * 0.4} fill="currentColor" strokeWidth={0} />
      ) : (
        <Play size={size * 0.4} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />
      )}
    </motion.button>
  );
}

export const TrackCard = memo(function TrackCard({
  track,
  list,
  context,
  width = 176,
  showReason = true,
}: {
  track: Track;
  list?: Track[];
  context?: { label: string; href?: string };
  width?: number;
  showReason?: boolean;
}) {
  const actions = useTrackActions();
  const canPlay = usePlayable();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing) && isCurrent;
  const toggle = usePlayer((s) => s.toggle);
  const onPlay = () => (isCurrent ? toggle() : actions.play(track, list, context));
  return (
    <TrackContextMenu track={track}>
      <motion.div
        className="group relative shrink-0 snap-start"
        style={{ width }}
        whileHover="hover"
        initial="rest"
        animate="rest"
      >
        <div className="relative cursor-pointer" onClick={() => actions.goTrack(track)}>
          <motion.div variants={{ rest: { y: 0 }, hover: { y: -3 } }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
            <AlbumArt
              art={track.art}
              seed={track.id}
              size={width}
              className="aspect-square w-full shadow-[0_14px_34px_-18px_rgb(0_0_0/0.85)]"
              rounded="rounded-xl"
            />
          </motion.div>
          <motion.div
            className="absolute bottom-2.5 right-2.5"
            variants={{ rest: { opacity: isCurrent ? 1 : 0, y: isCurrent ? 0 : 8 }, hover: { opacity: 1, y: -3 } }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          >
            {canPlay(track) && <PlayFab playing={playing} onClick={onPlay} size={42} />}
          </motion.div>
          <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 has-[[data-state=open]]:opacity-100" onClick={(e) => e.stopPropagation()}>
            <TrackMenu
              track={track}
              trigger={
                <button
                  aria-label="More"
                  className="grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur transition-colors hover:bg-black/65"
                >
                  <MoreHorizontal size={16} />
                </button>
              }
            />
          </div>
        </div>
        <div className="mt-2.5 min-w-0 px-0.5">
          <button
            onClick={() => actions.goTrack(track)}
            className={cn("block w-full truncate text-left text-[14px] font-semibold", isCurrent ? "text-accent" : "text-fg-0")}
          >
            {track.title}
          </button>
          <button
            onClick={() => actions.goArtist(track)}
            className="block w-full truncate text-left text-[13px] text-fg-2 transition-colors hover:text-fg-1"
          >
            {track.artist.name}
            {track.year ? ` · ${track.year}` : ""}
          </button>
          {showReason && track.reasons.length > 0 && <ReasonLine reasons={track.reasons} className="mt-1.5 w-full" />}
        </div>
      </motion.div>
    </TrackContextMenu>
  );
});

export function PlaylistCard({
  playlist,
  arts,
  width = 176,
  fluid,
}: {
  playlist: PlaylistSummary;
  arts: (Art | null | undefined)[];
  width?: number;
  fluid?: boolean;
}) {
  const navigate = useNavigate();
  const isLane = playlist.kind === "lane" || playlist.id.startsWith("lane:");
  return (
    <motion.button
      onClick={() => navigate(`/playlist/${encodeURIComponent(playlist.id)}`)}
      className={cn("group shrink-0 snap-start text-left", fluid && "w-full")}
      style={fluid ? undefined : { width }}
      whileHover="hover"
      initial="rest"
      animate="rest"
    >
      <motion.div
        variants={{ rest: { y: 0 }, hover: { y: -3 } }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="relative"
      >
        <Mosaic arts={arts} size={fluid ? 240 : width} className="aspect-square w-full shadow-[0_14px_34px_-18px_rgb(0_0_0/0.85)]" />
        {isLane && (
          <div className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
            Karasu
          </div>
        )}
      </motion.div>
      <div className="mt-2.5 truncate text-[14px] font-semibold text-fg-0">{playlist.name}</div>
      <div className="truncate text-[13px] text-fg-2">
        {playlist.kind === "spotify" && !isLane
          ? `${playlist.own ? "Yours" : `by ${playlist.owner ?? "someone"}`} · ${playlist.count} songs`
          : `${playlist.count} songs${playlist.description ? ` · ${playlist.description}` : ""}`}
      </div>
    </motion.button>
  );
}

export function ArtistCard({ artist, width = 150 }: { artist: Artist | { dz_id: null; name: string; art: null }; width?: number }) {
  const href = artist.dz_id ? `/artist/${artist.dz_id}` : `/search?q=${encodeURIComponent(artist.name)}`;
  const full = artist as Artist;
  return (
    <Link to={href} className="group shrink-0 snap-start text-center" style={{ width }}>
      <motion.div whileHover={{ scale: 1.035 }} transition={{ type: "spring", stiffness: 400, damping: 28 }}>
        <AlbumArt
          art={artist.art}
          seed={artist.name}
          size={width}
          rounded="rounded-full"
          className="aspect-square w-full shadow-[0_14px_34px_-18px_rgb(0_0_0/0.85)]"
        />
      </motion.div>
      <div className="mt-2.5 truncate text-[14px] font-semibold text-fg-0">{artist.name}</div>
      {full.fans != null && (
        <div className="truncate text-xs text-fg-2">
          {full.tier ? tierLabel[full.tier] : "Artist"} · {compact(full.fans)} fans
        </div>
      )}
    </Link>
  );
}
