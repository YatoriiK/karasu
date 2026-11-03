import { useEffect } from "react";
import { engine } from "../player/engine";
import { motionScale, usePrefs } from "../store/prefs";
import { applyLook, useLook } from "../theme/look";
import { useDeskLooks } from "../theme/deskLook";

export function usePrefsEffect() {
  useDeskLooks();
  const look = useLook((s) => s.look);
  const motion = usePrefs((s) => s.motion);
  const crossfade = usePrefs((s) => s.crossfade);
  const outputDevice = usePrefs((s) => s.outputDevice);
  useEffect(() => {
    applyLook(look);
  }, [look]);
  useEffect(() => {
    document.documentElement.style.setProperty("--motion-scale", String(motionScale(motion)));
  }, [motion]);
  useEffect(() => {
    engine.crossfade = crossfade;
  }, [crossfade]);
  useEffect(() => {
    void engine.setOutput(outputDevice);
  }, [outputDevice]);
}
