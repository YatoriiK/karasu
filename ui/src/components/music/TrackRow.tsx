import { memo } from "react";
import { motion } from "motion/react";
import { MoreHorizontal, Pause, Play } from "lucide-react";
import type { Track } from "../../lib/types";
import { duration } from "../../lib/format";
import { listItem } from "../../lib/motion";
import { currentTrack, usePlayable, usePlayer } from "../../store/player";
import { cn } from "../ui/cn";
import { Equalizer } from "../ui/states";
import { AlbumArt } from "./AlbumArt";
import { LikeButton } from "./LikeButton";
import { usePrefs } from "../../store/prefs";
import { useFx } from "../../theme/look";
import { ReasonLine } from "./Reasons";
import { TrackContextMenu, TrackMenu } from "./TrackMenu";
import { useTrackActions } from "./useTrackActions";

type Props = {
  track: Track;
  index?: number;
  list?: Track[];
  context?: { label: string; href?: string };
  showAlbum?: boolean;
  showReason?: boolean;
  compact?: boolean;
  animate?: boolean;
  lead?: string;
};

const COLS = {
  album: "grid-cols-[24px_minmax(0,1fr)_40px_32px] sm:grid-cols-[28px_minmax(0,1fr)_32px_44px_32px] md:grid-cols-[28px_minmax(0,2.2fr)_minmax(0,1fr)_32px_44px_32px]",
  plain: "grid-cols-[24px_minmax(0,1fr)_40px_32px] sm:grid-cols-[28px_minmax(0,1fr)_32px_44px_32px]",
  leadAlbum: "grid-cols-[46px_minmax(0,1fr)_40px_32px] sm:grid-cols-[60px_minmax(0,1fr)_32px_44px_32px] md:grid-cols-[60px_minmax(0,2.2fr)_minmax(0,1fr)_32px_44px_32px]",
  leadPlain: "grid-cols-[46px_minmax(0,1fr)_40px_32px] sm:grid-cols-[60px_minmax(0,1fr)_32px_44px_32px]",
};

export const TrackRow = memo(function TrackRow({
  track,
  index,
  list,
  context,
  showAlbum = true,
  showReason: wantReason = true,
  compact: wantCompact,
  animate = true,
  lead,
}: Props) {
  const actions = useTrackActions();
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const playing = usePlayer((s) => s.playing);
  const toggle = usePlayer((s) => s.toggle);
  const canPlay = usePlayable();
  const density = useFx("listDensity");
  const reasonsOn = usePrefs((s) => s.reasons);
  const compact = wantCompact ?? density === "compact";
  const showReason = wantReason && reasonsOn;
  const disabled = !canPlay(track);
  const onPlay = () => (isCurrent ? toggle() : actions.play(track, list, context));

  return (
    <TrackContextMenu track={track}>
      <motion.div
        variants={animate ? listItem : undefined}
        onDoubleClick={onPlay}
        className={cn(
          "group grid items-center gap-2 rounded-lg px-1.5 transition-colors duration-150 sm:gap-3 sm:px-2",
          compact ? "h-12" : "h-14",
          lead != null ? (showAlbum ? COLS.leadAlbum : COLS.leadPlain) : showAlbum ? COLS.album : COLS.plain,
          isCurrent ? "bg-bg-3/70" : "hover:bg-bg-2/80",
          track.state.hidden && "opacity-45",
        )}
      >
        <div className={cn("relative grid h-8 place-items-center text-fg-3 tabular", lead != null ? "w-full text-[11px] sm:text-xs" : "w-6 text-sm sm:w-7")}>
          <span className={cn("whitespace-nowrap transition-opacity duration-150 group-hover:opacity-0", isCurrent && "opacity-0")}>
            {lead ?? (index != null ? index + 1 : "")}
          </span>
          {isCurrent && !playing && <span className="absolute group-hover:opacity-0"><Play size={13} className="text-accent" /></span>}
          {isCurrent && playing && (
            <span className="absolute group-hover:opacity-0">
              <Equalizer playing />
            </span>
          )}
          <button
            aria-label={isCurrent && playing ? "Pause" : "Play"}
            onClick={onPlay}
            disabled={disabled}
            className="absolute inset-0 grid place-items-center text-fg-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 disabled:text-fg-3"
          >
            {isCurrent && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <AlbumArt art={track.art} seed={track.id} size={compact ? 36 : 42} className={compact ? "h-9 w-9" : "h-[42px] w-[42px]"} rounded="rounded-md" />
          <div className="min-w-0 flex-1">
            <div className={cn("truncate text-[14px] font-medium leading-tight", isCurrent ? "text-accent" : "text-fg-0")}>
              {track.title}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
              <button
                onClick={() => actions.goArtist(track)}
                className={cn(
                  "truncate text-left transition-colors hover:text-fg-0 hover:underline underline-offset-2",
                  showReason && track.reasons.length > 0 ? "max-w-[60%] shrink-0 lg:max-w-[45%]" : "min-w-0",
                )}
              >
                {track.artist.name}
              </button>
              {showReason && track.reasons.length > 0 && (
                <>
                  <span className="hidden text-fg-3 lg:inline">·</span>
                  <ReasonLine reasons={track.reasons} className="hidden min-w-0 flex-1 lg:inline-flex" />
                </>
              )}
              {disabled && <span className="shrink-0 rounded bg-bg-3 px-1.5 text-2xs text-fg-3">No preview</span>}
            </div>
          </div>
        </div>

        {showAlbum && (
          <div className="hidden min-w-0 truncate text-[13px] text-fg-2 md:block">
            {track.album.title}
            {track.year ? <span className="text-fg-3"> · {track.year}</span> : null}
          </div>
        )}

        <div className="hidden opacity-0 transition-opacity duration-150 group-hover:opacity-100 data-[on=true]:opacity-100 sm:block" data-on={track.state.liked}>
          <LikeButton track={track} size={16} />
        </div>
        <div className="text-right text-[13px] text-fg-3 tabular">{duration(track.duration_s)}</div>
        <TrackMenu
          track={track}
          trigger={
            <button
              aria-label="More"
              className="grid h-8 w-8 place-items-center rounded-full text-fg-2 opacity-0 transition-all duration-150 hover:bg-bg-4 hover:text-fg-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal size={17} />
            </button>
          }
        />
      </motion.div>
    </TrackContextMenu>
  );
});

export function TrackList({
  tracks,
  context,
  showAlbum,
  showReason,
  compact,
  numbered = true,
}: {
  tracks: Track[];
  context?: { label: string; href?: string };
  showAlbum?: boolean;
  showReason?: boolean;
  compact?: boolean;
  numbered?: boolean;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.025 } } }}
      className="flex flex-col"
    >
      {tracks.map((t, i) => (
        <TrackRow
          key={t.id}
          track={t}
          index={numbered ? i : undefined}
          list={tracks}
          context={context}
          showAlbum={showAlbum}
          showReason={showReason}
          compact={compact}
          animate={i < 14}
        />
      ))}
    </motion.div>
  );
}
