import { useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Keyboard, Speaker, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { usePrefs } from "../store/prefs";
import { useUi } from "../store/ui";
import { Button } from "../components/ui/Button";
import { Slider, Toggle } from "../components/ui/controls";
import { Skeleton } from "../components/ui/states";
import { ShortcutList } from "../components/shell/ShortcutsDialog";
import { Choice, Group, Row } from "./settings/ui";
import { reconnectSpotify } from "../hooks/useSpotifyBackground";
import { useConnect } from "../store/connect";
import { usePlayer } from "../store/player";
import { LookEditor } from "./settings/LookEditor";
import { ButtonSkins } from "./settings/ButtonSkins";
import { GlobalKeys } from "./settings/GlobalKeys";
import { KeyRow, ListenerMapRow } from "./settings/Connections";
import { AssetLibrary } from "../desk/AssetLibrary";
import { ScrollContext } from "../app/scroll";
import { useDeskLookState } from "../theme/deskLook";
import { cn } from "../components/ui/cn";

function bytes(n: number | undefined) {
  if (!n) return "0 MB";
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

function EngineSlider({ s }: { s: { key: string; label: string; min: number; max: number; step: number; value: number } }) {
  const [value, setValue] = useState(s.value);
  return (
    <Row label={s.label}>
      <Slider
        value={value}
        min={s.min}
        max={s.max}
        step={s.step}
        label={s.label}
        className="w-48"
        onChange={setValue}
        onCommit={async (v) => {
          await api.setSetting(s.key, v);
          toast("Saved. It applies to the next discovery run");
        }}
      />
      <span className="w-14 text-right text-sm text-fg-1 tabular">{value.toLocaleString()}</span>
    </Row>
  );
}

type Output = { deviceId: string; label: string };

function useOutputs() {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [hidden, setHidden] = useState(false);
  const load = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const list = devices.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
      setHidden(list.length > 0 && list.every((d) => !d.label));
      setOutputs(list.filter((d) => d.label).map((d) => ({ deviceId: d.deviceId, label: d.label })));
    } catch {
      setOutputs([]);
    }
  };
  useEffect(() => {
    void load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, []);
  const unlock = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast("Device names stay hidden", { description: "Windows only shares speaker names after microphone access is allowed." });
    }
    await load();
  };
  return { outputs, hidden, unlock };
}

function ConfirmButton({ label, confirm, onConfirm, icon }: { label: string; confirm: string; onConfirm: () => Promise<void>; icon?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <Button
      size="sm"
      variant={armed ? "danger" : "secondary"}
      icon={icon}
      disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {armed ? confirm : label}
    </Button>
  );
}

const NAV: { title: string; items: [string, string][] }[] = [
  {
    title: "Look and feel",
    items: [
      ["appearance", "Look"],
      ["colors", "Colors"],
      ["type", "Type"],
      ["wallpaper", "Wallpaper"],
      ["effects", "Effects"],
      ["cursor", "Cursor"],
      ["layout", "Layout"],
      ["css", "Custom CSS"],
      ["buttons", "Buttons"],
      ["images", "Images"],
    ],
  },
  {
    title: "Music and app",
    items: [
      ["playback", "Playback"],
      ["discovery", "Discovery"],
      ["privacy", "Privacy & data"],
      ["hidden", "Hidden"],
      ["connections", "Connections"],
      ["shortcuts", "Shortcuts"],
      ["anywhere", "In other apps"],
    ],
  },
];

const SECTIONS = NAV.flatMap((g) => g.items.map(([id]) => id));

function useActiveSection() {
  const scroller = useContext(ScrollContext);
  const [active, setActive] = useState(SECTIONS[0]);
  useEffect(() => {
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { root: scroller.current, rootMargin: "-6% 0px -72% 0px" },
    );
    for (const id of SECTIONS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [scroller]);
  return [active, setActive] as const;
}

function SectionNav({ active, onGo, wide, scope }: { active: string; onGo: (id: string) => void; wide: boolean; scope?: string }) {
  const link = (id: string, label: string) => (
    <a
      key={id}
      href={`#${id}`}
      aria-current={active === id ? "true" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onGo(id);
      }}
      className={cn(
        "rounded-lg text-[13px] font-medium transition-colors",
        wide ? "block px-3 py-1.5" : "shrink-0 px-3 py-1.5 hairline",
        active === id ? "bg-bg-3 text-fg-0" : "text-fg-2 hover:bg-bg-3/60 hover:text-fg-0",
      )}
    >
      {label}
    </a>
  );
  if (!wide)
    return (
      <nav className="mb-8 mt-4 flex flex-wrap gap-1.5 lg:hidden" aria-label="Settings sections">
        {NAV.flatMap((g) => g.items.map(([id, label]) => link(id, label)))}
      </nav>
    );
  return (
    <nav className="no-scrollbar sticky top-10 hidden max-h-[calc(100vh-220px)] self-start overflow-y-auto pt-[62px] lg:block" aria-label="Settings sections">
      {NAV.map((g) => (
        <div key={g.title} className="mb-5">
          <div className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">{g.title}</div>
          {scope && g === NAV[0] && <div className="-mt-1 mb-1.5 truncate px-3 text-[11px] text-fg-2" data-nav-scope>for {scope}</div>}
          <div className="space-y-0.5">{g.items.map(([id, label]) => link(id, label))}</div>
        </div>
      ))}
    </nav>
  );
}

export function SettingsPage() {
  const prefs = usePrefs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: exclusions } = useQuery({ queryKey: ["exclusions"], queryFn: api.exclusions });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => api.health() });
  const { data: spotify } = useQuery({ queryKey: ["spotify-status"], queryFn: api.spotifyStatus });
  const { data: options } = useQuery({ queryKey: ["discover-options"], queryFn: api.discoverOptions, staleTime: Infinity });
  const { data: storage, refetch: refetchStorage } = useQuery({ queryKey: ["storage"], queryFn: api.storage });
  const outputs = useOutputs();
  const spotifyReady = useConnect((s) => s.ready);
  const [active, setActive] = useActiveSection();
  const deskLook = useDeskLookState();
  const scope = deskLook.own && deskLook.layout ? deskLook.layout.name : "all desks";

  const connectSpotify = () =>
    reconnectSpotify(() => {
      qc.invalidateQueries({ queryKey: ["spotify-status"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    });

  const go = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto max-w-[1100px] pt-4 lg:grid lg:grid-cols-[172px_minmax(0,880px)] lg:justify-center lg:gap-10">
      <SectionNav active={active} onGo={go} wide scope={scope} />
      <div className="min-w-0">
        <h1 className="text-[34px] font-bold tracking-[-0.03em]">Settings</h1>
        <SectionNav active={active} onGo={go} wide={false} />
        <div className="hidden h-8 lg:block" />

        <LookEditor />
        <ButtonSkins />
        <Group
          id="images"
          title="Your images"
          description="Pictures, GIFs and short MP4 or WebM loops you import live here. Use them as wallpapers, desk stickers, cursors, widget backgrounds and buttons."
        >
          <div className="p-4">
            <AssetLibrary columns={8} videos />
          </div>
        </Group>

        <Group id="playback" title="Playback" description="Spotify plays the full songs in the background while you use Karasu. Without it, Karasu plays 30-second previews.">
          <Row label="Full songs through Spotify" hint={spotifyReady ? "Karasu sends songs to your Spotify app and controls it" : "Connect Spotify below to turn this on"}>
            <Toggle
              checked={prefs.fullSongs && spotifyReady}
              onChange={(fullSongs) => {
                prefs.set({ fullSongs });
                const player = usePlayer.getState();
                if (fullSongs && spotifyReady && player.source !== "spotify") player.setSource("spotify");
                if (!fullSongs && player.source === "spotify") player.setSource("preview");
              }}
              label="Full songs through Spotify"
            />
          </Row>
          <Row label="Start Spotify in the background" hint="Starts Spotify when Karasu opens and keeps its window out of sight. Show it any time from the device menu in the player.">
            <Toggle checked={prefs.launchSpotify} onChange={(launchSpotify) => prefs.set({ launchSpotify })} label="Start Spotify in the background" />
          </Row>
          <Row label="Visualizers follow your PC's sound" hint="Lets cava and the waveforms move with Spotify. Karasu only measures loudness per frequency; nothing is recorded or saved.">
            <Toggle checked={prefs.systemAudio} onChange={(systemAudio) => prefs.set({ systemAudio })} label="Visualizers follow your PC's sound" />
          </Row>
          <Row label="Crossfade" hint="Blend into the next preview">
            <Slider value={prefs.crossfade} min={0} max={12} step={1} label="Crossfade" className="w-48" onChange={(crossfade) => prefs.set({ crossfade })} />
            <span className="w-14 text-right text-sm text-fg-1 tabular">{prefs.crossfade ? `${prefs.crossfade}s` : "Off"}</span>
          </Row>
          <Row
            label="Output device"
            hint={
              outputs.hidden
                ? "Windows hides speaker names until microphone access is allowed. Karasu never records anything."
                : "Where previews play. For Spotify Connect, pick the device from the player bar."
            }
          >
            <Choice
              label="Output device"
              icon={<Speaker size={15} className="text-fg-2" />}
              value={prefs.outputDevice}
              onChange={(outputDevice) => prefs.set({ outputDevice })}
              options={[{ value: "", label: "System default" }, ...outputs.outputs.map((o) => ({ value: o.deviceId, label: o.label }))]}
            />
            {outputs.hidden && (
              <Button size="sm" variant="ghost" onClick={outputs.unlock}>
                Show devices
              </Button>
            )}
          </Row>
        </Group>

        <Group id="discovery" title="Discovery" description="How adventurous the weekly picks and recommendations are.">
          <Row label="Open Discover in" hint="The mode Discover starts with">
            <Choice
              label="Default discovery mode"
              value={prefs.defaultMode}
              onChange={(defaultMode) => prefs.set({ defaultMode })}
              options={(options?.modes ?? [{ id: "similar", title: "Similar Sounds" }]).map((m) => ({ value: m.id, label: m.title }))}
            />
          </Row>
          {settings ? settings.map((s) => <EngineSlider key={s.key} s={s} />) : <div className="p-5"><Skeleton className="h-24 rounded-lg" /></div>}
        </Group>

        <Group id="privacy" title="Privacy & data" description="Everything stays on this PC. The only traffic is the lookups needed to find music.">
          <Row label="Remember what I play here" hint="Previews you play for 10 seconds or more count toward History and Statistics">
            <Toggle checked={prefs.recordHistory} onChange={(recordHistory) => prefs.set({ recordHistory })} label="Record in-app listening" />
          </Row>
          <Row label="Search history" hint="Recent searches shown in the search box">
            <Button
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={async () => {
                await api.clearSearchHistory();
                qc.invalidateQueries({ queryKey: ["suggest"] });
                toast("Search history cleared");
              }}
            >
              Clear
            </Button>
          </Row>
          <Row label="Listening history" hint="Clears History and Statistics. Your Spotify library, likes and taste profile stay as they are.">
            <ConfirmButton
              label="Reset"
              confirm="Click again to reset"
              icon={<Trash2 size={14} />}
              onConfirm={async () => {
                const res = await api.resetHistory();
                qc.invalidateQueries();
                toast(`Removed ${res.removed.toLocaleString()} plays`);
              }}
            />
          </Row>
          <Row
            label="Preview cache"
            hint={storage ? `${storage.audio.files.toLocaleString()} previews · ${bytes(storage.audio.bytes)}, downloaded again when needed` : "Checking…"}
          >
            <Button
              size="sm"
              icon={<Trash2 size={14} />}
              disabled={!storage?.audio.files}
              onClick={async () => {
                const res = await api.clearAudioCache();
                await refetchStorage();
                toast(`Cleared ${res.removed.toLocaleString()} cached previews`);
              }}
            >
              Clear
            </Button>
          </Row>
          <Row label="Storage" hint={storage ? `Artwork ${bytes(storage.art.bytes)} · Library database ${bytes(storage.database)}` : "Checking…"}>
            <span className="max-w-[260px] truncate text-[13px] text-fg-3" title={storage?.location}>
              {storage?.location}
            </span>
          </Row>
        </Group>

        <Group id="hidden" title="Hidden" description="Artists and songs you never want to see.">
          {exclusions && exclusions.length > 0 ? (
            exclusions.map((e) => (
              <Row key={`${e.kind}:${e.value}`} label={e.label || e.value} hint={e.kind === "artist" ? "Artist" : e.kind === "genre" ? "Genre" : "Song"}>
                <button
                  onClick={async () => {
                    await api.removeExclusion(e.kind, e.value);
                    qc.invalidateQueries({ queryKey: ["exclusions"] });
                    qc.invalidateQueries({ queryKey: ["home"] });
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-bg-3 px-3 py-1.5 text-[13px] font-medium text-fg-1 hover:bg-bg-4 hover:text-fg-0"
                >
                  <X size={13} /> Unhide
                </button>
              </Row>
            ))
          ) : (
            <div className="px-5 py-6 text-sm text-fg-3">Nothing hidden. Use “Never show this artist” from any song's menu.</div>
          )}
        </Group>

        <Group id="connections" title="Connections" description="Spotify brings in your library and plays full songs. Last.fm and Discogs are optional extras that sharpen discovery.">
          <Row
            label="Spotify"
            hint={
              !spotify?.configured
                ? "Needs Spotify Premium and a free developer app. The setup guide walks you through it."
                : spotify.missing_scopes.length
                  ? "Reconnect once to allow playback control, saving songs and playlist covers"
                  : health?.spotify?.logged_in
                    ? `Connected as ${health.spotify.user?.name ?? "you"}`
                    : "Not connected"
            }
          >
            {spotify && !spotify.configured ? (
              <Button size="sm" variant="primary" onClick={() => navigate("/welcome?step=key&path=premium")}>
                Set up
              </Button>
            ) : spotify?.missing_scopes.length || !health?.spotify?.logged_in ? (
              <Button size="sm" variant="primary" onClick={connectSpotify}>
                {health?.spotify?.logged_in ? "Reconnect" : "Connect"}
              </Button>
            ) : (
              <span className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-semibold text-good">Connected</span>
            )}
          </Row>
          <Row label="Setup guide" hint="Connect Spotify, pick artists you love, or get your full listening history from Spotify.">
            <Button size="sm" variant="ghost" onClick={() => navigate("/welcome")}>
              Open
            </Button>
          </Row>
          <KeyRow service="lastfm" set={health?.keys?.lastfm} />
          <KeyRow service="discogs" set={health?.keys?.discogs} />
          <ListenerMapRow />
        </Group>

        <section id="shortcuts" className="mb-10 scroll-mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Keyboard shortcuts</h2>
            <Button size="sm" variant="ghost" icon={<Keyboard size={14} />} onClick={() => useUi.getState().set({ shortcutsOpen: true })}>
              Press ? anywhere
            </Button>
          </div>
          <div className="mt-4 rounded-2xl bg-bg-2/70 px-5 py-2 hairline">
            <ShortcutList />
          </div>
        </section>

        <GlobalKeys />

        <p className="pb-8 text-center text-xs text-fg-3">
          Karasu {health?.version} · {health?.corpus?.toLocaleString()} songs analyzed by the audio model · previews by Deezer, lyrics by LRCLIB
        </p>
      </div>
    </div>
  );
}
