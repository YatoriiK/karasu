import { AnimatePresence, motion } from "motion/react";
import {
  ChevronUp,
  ListMusic,
  Loader2,
  MicVocal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useConnect } from "../../store/connect";
import { currentTrack, useLiveArt, usePlayer } from "../../store/player";
import { useFx } from "../../theme/look";
import { Skin } from "../../theme/skins";
import { useUi } from "../../store/ui";
import { IconButton } from "../ui/Button";
import { Slider } from "../ui/controls";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/Tooltip";
import { AlbumArt } from "../music/AlbumArt";
import { LikeButton } from "../music/LikeButton";
import { TrackContextMenu } from "../music/TrackMenu";
import { useTrackActions } from "../music/useTrackActions";
import { DevicePicker } from "./DevicePicker";
import { Seekbar } from "./Seekbar";

export function PlayButton({ size = 40 }: { size?: number }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const toggle = usePlayer((s) => s.toggle);
  const has = usePlayer((s) => s.index >= 0);
  return (
    <motion.button
      aria-label={playing ? "Pause" : "Play"}
      onClick={toggle}
      disabled={!has}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 600, damping: 26 }}
      style={{ width: size, height: size }}
      className="grid place-items-center rounded-full bg-fg-0 text-bg-0 disabled:opacity-40"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={buffering && playing ? "load" : playing ? "pause" : "play"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="grid place-items-center"
        >
          {buffering && playing ? (
            <Loader2 size={size * 0.42} className="animate-spin" />
          ) : playing ? (
            <Skin slot="player.pause" size={size * 0.42}>
              <Pause size={size * 0.42} fill="currentColor" strokeWidth={0} />
            </Skin>
          ) : (
            <Skin slot="player.play" size={size * 0.42}>
              <Play size={size * 0.42} fill="currentColor" strokeWidth={0} className="translate-x-[1.5px]" />
            </Skin>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

export function Transport({ large }: { large?: boolean }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  const icon = large ? 22 : 18;
  return (
    <div className={cn("flex items-center", large ? "gap-5" : "gap-2")}>
      <IconButton label={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle} size={large ? "lg" : "sm"} round onClick={toggleShuffle}>
        <Skin slot="player.shuffle" size={icon - 2}>
          <Shuffle size={icon - 2} />
        </Skin>
      </IconButton>
      <IconButton label="Previous" size={large ? "lg" : "sm"} round onClick={prev}>
        <Skin slot="player.prev" size={icon}>
          <SkipBack size={icon} fill="currentColor" />
        </Skin>
      </IconButton>
      <PlayButton size={large ? 64 : 38} />
      <IconButton label="Next" size={large ? "lg" : "sm"} round onClick={() => next()}>
        <Skin slot="player.next" size={icon}>
          <SkipForward size={icon} fill="currentColor" />
        </Skin>
      </IconButton>
      <IconButton
        label={repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one"}
        active={repeat !== "off"}
        size={large ? "lg" : "sm"}
        round
        onClick={cycleRepeat}
      >
        <Skin slot="player.repeat" size={icon - 2}>
          {repeat === "one" ? <Repeat1 size={icon - 2} /> : <Repeat size={icon - 2} />}
        </Skin>
      </IconButton>
    </div>
  );
}

function Volume() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const { setVolume, toggleMute } = usePlayer.getState();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
      <IconButton label={muted ? "Unmute" : "Mute"} size="sm" round onClick={toggleMute}>
        <Icon size={17} />
      </IconButton>
      <span className="hidden xl:block">
        <Slider value={muted ? 0 : volume} onChange={setVolume} label="Volume" className="w-20" thin />
      </span>
    </div>
  );
}

export function SourcePill() {
  const source = usePlayer((s) => s.source);
  const chosen = usePlayer((s) => s.deviceName);
  const device = useConnect((s) => s.state?.device?.name) ?? chosen ?? "Spotify";
  if (source === "spotify") {
    return (
      <Tooltip label="Full songs are playing in your Spotify app">
        <span className="hidden h-5 max-w-[200px] shrink-0 items-center rounded-full bg-good/15 px-2 text-2xs font-semibold uppercase tracking-wider text-good sm:inline-flex">
          <span className="truncate">On {device}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip label="30-second preview from Deezer. Pick a Spotify device under Devices for full songs.">
      <span className="hidden h-5 items-center rounded-full bg-bg-4/80 px-2 text-2xs font-semibold uppercase tracking-wider text-fg-2 sm:inline-flex">
        Preview
      </span>
    </Tooltip>
  );
}

export function PlayerBar() {
  const track = usePlayer(currentTrack);
  const liveArt = useLiveArt(track);
  const ui = useUi();
  const actions = useTrackActions();
  const docked = useFx("playerStyle") === "docked";
  return (
    <div className={cn("relative z-40 hidden shrink-0 md:block", docked ? "" : "px-2 pb-2")}>
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 30, delay: 0.15 }}
        className={cn(
          "relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 overflow-hidden",
          docked ? "glass-flat h-[72px] border-t border-line px-4" : "glass mx-auto h-[68px] max-w-[1180px] rounded-pill pl-2.5 pr-5",
        )}
      >
        <TrackContextMenu track={track}>
          <div className="relative flex min-w-0 items-center gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {track ? (
                <motion.button
                  key="art"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => ui.set({ nowPlaying: true })}
                  className="group relative shrink-0"
                  aria-label="Open Now Playing"
                >
                  <AlbumArt art={track.art} fallback={liveArt} seed={track.id} size={54} layoutId="np-art" className="h-[50px] w-[50px]" rounded={docked ? "rounded-md" : "rounded-pill"} />
                  <span className={cn("absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100", docked ? "rounded-md" : "rounded-pill")}>
                    <ChevronUp size={20} className="text-white" />
                  </span>
                </motion.button>
              ) : (
                <div className="seal grid h-[50px] w-[50px] shrink-0 place-items-center rounded-pill bg-bg-3 text-[22px] text-fg-3">烏</div>
              )}
            </AnimatePresence>
            <div className="min-w-0">
              {track ? (
                <>
                  <button onClick={() => actions.goTrack(track)} className="block max-w-full truncate text-left text-[14px] font-semibold text-fg-0 hover:underline underline-offset-2">
                    {track.title}
                  </button>
                  <button onClick={() => actions.goArtist(track)} className="block max-w-full truncate text-left text-[13px] text-fg-2 hover:text-fg-0">
                    {track.artist.name}
                  </button>
                </>
              ) : (
                <>
                  <div className="truncate text-[14px] font-semibold text-fg-1">Nothing playing</div>
                  <div className="truncate text-[13px] text-fg-3">pick a song to start digging</div>
                </>
              )}
            </div>
            {track && <LikeButton track={track} className="shrink-0" />}
          </div>
        </TrackContextMenu>

        <div className="relative flex w-[min(46vw,560px)] flex-col items-center gap-0.5">
          <Transport />
          <Seekbar />
        </div>

        <div className="relative flex min-w-0 items-center justify-end gap-1">
          <IconButton label="Lyrics" size="sm" round className="shrink-0" active={ui.lyricsOpen} onClick={() => ui.set({ nowPlaying: true, lyricsOpen: true })}>
            <MicVocal size={17} />
          </IconButton>
          <IconButton label="Queue" size="sm" round className="shrink-0" active={ui.queueOpen} onClick={() => ui.set({ queueOpen: !ui.queueOpen })}>
            <ListMusic size={17} />
          </IconButton>
          <DevicePicker />
          <Volume />
        </div>
      </motion.div>
    </div>
  );
}
