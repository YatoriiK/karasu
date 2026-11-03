import { useEffect } from "react";
import { useMotionValue, type MotionValue } from "motion/react";
import { engine } from "../player/engine";
import { connectDuration, connectTime } from "../store/connect";
import { usePlayer } from "../store/player";

export function playbackNow() {
  return usePlayer.getState().source === "spotify" ? connectTime() : engine.currentTime;
}

export function playbackTotal() {
  return usePlayer.getState().source === "spotify" ? connectDuration() : engine.duration;
}

let shared: { time: MotionValue<number>; duration: MotionValue<number>; users: number; raf: number } | null = null;

export function usePlaybackClock(time: MotionValue<number>, duration: MotionValue<number>) {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      time.set(playbackNow());
      duration.set(playbackTotal());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [time, duration]);
}

export function usePlaybackTime() {
  const time = useMotionValue(0);
  const duration = useMotionValue(0);
  usePlaybackClock(time, duration);
  return { time, duration };
}

export function useSharedPlayback() {
  const time = useMotionValue(0);
  const duration = useMotionValue(0);
  useEffect(() => {
    if (!shared) {
      shared = { time, duration, users: 0, raf: 0 };
      const tick = () => {
        shared!.time.set(playbackNow());
        shared!.duration.set(playbackTotal());
        shared!.raf = requestAnimationFrame(tick);
      };
      shared.raf = requestAnimationFrame(tick);
    }
    shared.users += 1;
    return () => {
      if (!shared) return;
      shared.users -= 1;
      if (shared.users <= 0) {
        cancelAnimationFrame(shared.raf);
        shared = null;
      }
    };
  }, [time, duration]);
  return shared ? { time: shared.time, duration: shared.duration } : { time, duration };
}
