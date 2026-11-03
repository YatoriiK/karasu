import { useState } from "react";
import { Popover } from "radix-ui";
import { Check, Laptop, Loader2, MonitorSpeaker, Smartphone, Speaker } from "lucide-react";
import { api } from "../../lib/api";
import { showSpotifyApp, spotifyApp, type SpotifyApp } from "../../lib/tauri";
import { loadDevices, useConnect } from "../../store/connect";
import { usePlayer } from "../../store/player";
import { IconButton } from "../ui/Button";
import { cn } from "../ui/cn";

function DeviceIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t.includes("smartphone")) return <Smartphone size={17} />;
  if (t.includes("computer")) return <Laptop size={17} />;
  return <Speaker size={17} />;
}

export function DevicePicker() {
  const source = usePlayer((s) => s.source);
  const deviceName = usePlayer((s) => s.deviceName);
  const setSource = usePlayer((s) => s.setSource);
  const devices = useConnect((s) => s.devices);
  const missing = useConnect((s) => s.missingScopes);
  const error = useConnect((s) => s.error);
  const playingOn = useConnect((s) => s.state?.device?.name) ?? deviceName ?? "Spotify";
  const [loading, setLoading] = useState(false);
  const [app, setApp] = useState<SpotifyApp | null>(null);
  const needsReconnect = missing.some((s) => s.includes("playback"));
  return (
    <Popover.Root
      onOpenChange={async (open) => {
        if (open) {
          setLoading(true);
          const [, state] = await Promise.all([loadDevices(), spotifyApp()]);
          setApp(state);
          setLoading(false);
        }
      }}
    >
      <Popover.Trigger asChild>
        {source === "spotify" ? (
          <button
            aria-label={`Playing on ${playingOn}. Change device`}
            className="flex h-8 min-w-0 max-w-[150px] items-center gap-1.5 rounded-full bg-good/15 px-2.5 text-good transition-colors hover:bg-good/25"
          >
            <MonitorSpeaker size={15} className="shrink-0" />
            <span className="truncate text-2xs font-semibold uppercase tracking-wider">{playingOn}</span>
          </button>
        ) : (
          <IconButton label="Devices" size="sm" round className="shrink-0">
            <MonitorSpeaker size={17} />
          </IconButton>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={12}
          className="z-[70] w-[320px] rounded-xl bg-bg-3 p-2 elevated data-[state=open]:animate-[menu-in_180ms_var(--ease-out)]"
        >
          <div className="px-2.5 pb-2 pt-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">Play on</div>
          <button
            onClick={() => source !== "preview" && setSource("preview")}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-bg-4"
          >
            <span className={cn("grid h-9 w-9 place-items-center rounded-lg", source === "preview" ? "bg-accent text-accent-fg" : "bg-bg-4 text-fg-1")}>
              <Laptop size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-fg-0">This app</span>
              <span className="block text-xs text-fg-2">30-second previews, crossfade, visualizer</span>
            </span>
            {source === "preview" && <Check size={16} className="text-accent" />}
          </button>
          <div className="my-1.5 h-px bg-line" />
          <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
            <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">Spotify Connect · full songs</span>
            {loading && <Loader2 size={13} className="animate-spin text-fg-3" />}
          </div>
          {needsReconnect ? (
            <div className="m-1 rounded-lg bg-bg-2 p-3 text-xs text-fg-1">
              Spotify needs one more permission to play here.
              <button onClick={() => api.spotifyLogin()} className="mt-2 block rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">
                Reconnect Spotify
              </button>
            </div>
          ) : devices.length ? (
            devices.map((d) => {
              const active = source === "spotify" && deviceName === d.name;
              return (
                <button
                  key={d.id}
                  onClick={() => setSource("spotify", { id: d.id, name: d.name })}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-bg-4"
                >
                  <span className={cn("grid h-9 w-9 place-items-center rounded-lg", active ? "bg-good text-black" : "bg-bg-4 text-fg-1")}>
                    <DeviceIcon type={d.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-fg-0">{d.name}</span>
                    <span className="block text-xs capitalize text-fg-2">{d.type.toLowerCase()}{d.is_active ? " · active" : ""}</span>
                  </span>
                  {active && <Check size={16} className="text-good" />}
                </button>
              );
            })
          ) : (
            <p className="px-2.5 py-3 text-xs leading-relaxed text-fg-2">
              {error && !/device/i.test(error) ? error : "No Spotify devices found. Open Spotify on this PC or your phone and reopen this menu."}
            </p>
          )}
          {app && app !== "closed" && (
            <>
              <div className="my-1.5 h-px bg-line" />
              <button
                onClick={async () => {
                  const show = app === "hidden";
                  if (await showSpotifyApp(show)) setApp(show ? "shown" : "hidden");
                }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-4"
              >
                <span className="text-xs text-fg-2">{app === "hidden" ? "Spotify is running in the background" : "The Spotify window is open"}</span>
                <span className="shrink-0 text-xs font-semibold text-fg-0">{app === "hidden" ? "Show" : "Hide"}</span>
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
