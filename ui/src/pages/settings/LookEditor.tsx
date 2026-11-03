import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FONTS, fxOf, PRESETS, useLook, type Fx, type Look, type Wallpaper } from "../../theme/look";
import { useActiveLayout, useDesk } from "../../desk/store";
import { WallpaperFramer } from "../../components/shell/WallpaperFramer";
import { usePrefs } from "../../store/prefs";
import { AssetLibrary } from "../../desk/AssetLibrary";
import { Button } from "../../components/ui/Button";
import { Segmented, Slider, Toggle } from "../../components/ui/controls";
import { cn } from "../../components/ui/cn";
import { Choice, Group, Row } from "./ui";
import { LookScope } from "./LookScope";
import { ShareLook } from "./ShareLook";
import { ShareDesk } from "./ShareDesk";
import { VIZ_STYLES } from "../../components/viz/Waveform";
import { SCENES } from "../../components/visual/scenes";
import { INK_MODES } from "../../theme/skins";

function Preview({ look, name, kanji, active, onClick }: { look: Look; name: string; kanji: string; active: boolean; onClick: () => void }) {
  const shadow =
    look.shadow === "hard" ? "5px 5px 0 rgb(0 0 0 / 0.3)" : look.shadow === "glow" ? `0 0 18px -4px ${look.ink}55` : look.shadow === "soft" ? "0 12px 24px -10px rgb(0 0 0 / 0.6)" : "none";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn("relative h-[124px] overflow-hidden text-left transition-transform hover:-translate-y-0.5", active ? "outline outline-2 outline-offset-2 outline-fg-0" : "outline outline-1 outline-line-strong")}
      style={{ background: look.paper, color: look.ink, borderRadius: Math.min(look.radius, 12) }}
    >
      <div
        className="absolute left-3 right-8 top-3 h-[64px] overflow-hidden"
        style={{
          background: `color-mix(in srgb, ${look.surface} ${Math.round(look.surfaceAlpha * 100)}%, transparent)`,
          border: `${look.border}px solid color-mix(in srgb, ${look.ink} 25%, transparent)`,
          borderRadius: Math.min(look.radius, 12) * 0.7,
          boxShadow: shadow,
        }}
      >
        {look.titlebar === "bar" && (
          <div className="flex h-3 items-center justify-end gap-0.5 px-1" style={{ background: look.ink }}>
            {[0, 1, 2].map((i) => (
              <i key={i} className="block h-1 w-1" style={{ background: look.paper }} />
            ))}
          </div>
        )}
        {look.titlebar === "line" && <div className="mx-1.5 mt-1.5 h-px opacity-40" style={{ background: look.ink }} />}
        <div className="space-y-1 p-2">
          <div className="h-1.5 w-3/4 opacity-80" style={{ background: look.ink }} />
          <div className="h-1 w-1/2 opacity-40" style={{ background: look.ink }} />
          <div className="h-1 w-2/3 opacity-30" style={{ background: look.ink }} />
        </div>
      </div>
      <div className="absolute bottom-2 left-3 text-[13px] font-bold" style={{ fontFamily: "'Shippori Mincho', serif" }}>
        {name}
      </div>
      <div className="seal absolute bottom-1.5 right-2 text-[30px] opacity-85">{kanji}</div>
    </button>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // The typed text lives here until it's a real color. Otherwise every half-typed "#ff0" snapped back
  // to the old value and the box was impossible to edit.
  const [draft, setDraft] = useState<string | null>(null);
  const take = (raw: string) => {
    const hex = raw.trim().replace(/^#?/, "#");
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex.toLowerCase());
    else if (/^#[0-9a-fA-F]{3}$/.test(hex)) onChange(`#${[...hex.slice(1)].map((c) => c + c).join("")}`.toLowerCase());
  };
  return (
    <label className="flex items-center gap-2 rounded-md bg-bg-3/60 px-2 py-1.5 hairline">
      <input type="color" value={value.startsWith("#") ? value.slice(0, 7) : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 shrink-0 cursor-pointer rounded-sm bg-transparent" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-fg-1">{label}</span>
        <input
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.replace(/^#?/, "").length === 6) take(e.target.value);
          }}
          onBlur={() => {
            if (draft != null) take(draft);
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          className="w-full bg-transparent font-mono text-[11px] text-fg-3 outline-none"
          aria-label={`${label} hex`}
        />
      </span>
    </label>
  );
}

function FontChoice({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const known = FONTS.some((f) => f.id === value);
  const [custom, setCustom] = useState(known ? "" : value);
  return (
    <Row label={label} hint={known ? FONTS.find((f) => f.id === value)?.note : `System font: ${value}`}>
      <Choice
        label={label}
        value={known ? value : "system"}
        onChange={(v) => (v === "system" ? onChange(custom || "Segoe UI") : onChange(v))}
        options={[...FONTS.map((f) => ({ value: f.id, label: f.label })), { value: "system", label: "A font on this PC…" }]}
      />
      {!known && (
        <input
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            if (e.target.value.trim()) onChange(e.target.value.trim());
          }}
          placeholder="Font name"
          className="h-9 w-40 rounded-md bg-bg-3 px-2.5 text-[13px] text-fg-0 outline-none hairline"
        />
      )}
    </Row>
  );
}

export function LookEditor() {
  const { look, saved, set, setWallpaper, setFx, usePreset, useSaved, save, remove } = useLook();
  const prefs = usePrefs();
  const fx = fxOf(look);
  const [name, setName] = useState("");
  const layout = useActiveLayout();
  const deskWall = !layout?.data.look && layout?.data.wallpaper ? layout.data.wallpaper : null;
  const wp = deskWall ?? look.wallpaper;
  const setWp = (patch: Partial<Wallpaper>) =>
    deskWall ? useDesk.getState().update((x) => ({ ...x, wallpaper: { ...(x.wallpaper ?? look.wallpaper), ...patch } }), false) : setWallpaper(patch);
  return (
    <>
      <Group id="appearance" title="Look" description="Start from a preset, then change anything. Give a desk its own look and everything here follows that desk.">
        <LookScope />
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          {Object.entries(PRESETS).map(([id, p]) => (
            <Preview key={id} look={p.look} name={p.name} kanji={p.kanji} active={look.preset === id} onClick={() => usePreset(id)} />
          ))}
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {saved.map((s) => (
              <span key={s.id} className="flex items-center gap-1 rounded-pill bg-bg-3 py-1 pl-3 pr-1 text-[13px] hairline">
                <button onClick={() => useSaved(s.id)} className="text-fg-1 hover:text-fg-0">
                  {s.name}
                </button>
                <button aria-label={`Delete ${s.name}`} onClick={() => remove(s.id)} className="grid h-6 w-6 place-items-center rounded-pill text-fg-3 hover:text-fg-0">
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <Row label="Save this look" hint="Keep your changes as a look you can switch back to">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My look" className="h-9 w-40 rounded-md bg-bg-3 px-2.5 text-[13px] text-fg-0 outline-none hairline" />
          <Button
            size="sm"
            onClick={() => {
              save(name || "My look");
              setName("");
              toast("Look saved");
            }}
          >
            Save
          </Button>
        </Row>
        <ShareLook />
        <ShareDesk />
      </Group>

      <Group id="colors" title="Colors and surfaces">
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <ColorRow label="Background" value={look.paper} onChange={(paper) => set({ paper })} />
          <ColorRow label="Windows" value={look.surface} onChange={(surface) => set({ surface })} />
          <ColorRow label="Ink (text)" value={look.ink} onChange={(ink) => set({ ink })} />
          <ColorRow label="Accent" value={look.accent} onChange={(accent) => set({ accent })} />
          <ColorRow label="Text on accent" value={look.accentInk} onChange={(accentInk) => set({ accentInk })} />
        </div>
        <Row label="Light or dark" hint="Tells the app which way the contrast goes">
          <Segmented value={look.scheme} onChange={(scheme) => set({ scheme })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </Row>
        <Row label="Window transparency" hint="How much of the wallpaper shows through">
          <Slider value={Math.round((1 - look.surfaceAlpha) * 100)} min={0} max={100} step={1} label="Transparency" className="w-48" onChange={(v) => set({ surfaceAlpha: 1 - v / 100 })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{Math.round((1 - look.surfaceAlpha) * 100)}%</span>
        </Row>
        <Row label="Blur" hint="Frosted glass behind windows">
          <Slider value={look.blur} min={0} max={40} step={1} label="Blur" className="w-48" onChange={(blur) => set({ blur })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{look.blur}px</span>
        </Row>
        <Row label="Corners" hint="0 for square rice windows">
          <Slider value={look.radius} min={0} max={28} step={1} label="Corner radius" className="w-48" onChange={(radius) => set({ radius })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{look.radius}px</span>
        </Row>
        <Row label="Borders">
          <Slider value={look.border} min={0} max={4} step={0.5} label="Border width" className="w-48" onChange={(border) => set({ border })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{look.border}px</span>
        </Row>
        <Row label="Shadows">
          <Segmented
            value={look.shadow}
            onChange={(shadow) => set({ shadow })}
            options={[
              { value: "none", label: "None" },
              { value: "soft", label: "Soft" },
              { value: "hard", label: "Hard" },
              { value: "glow", label: "Glow" },
            ]}
          />
        </Row>
        <Row label="Ink glow" hint="Soft light around big text and the clock">
          <Slider value={look.glow} min={0} max={1} step={0.05} label="Glow" className="w-48" onChange={(glow) => set({ glow })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{Math.round(look.glow * 100)}%</span>
        </Row>
        <Row label="Paper grain" hint="Film-grain texture over everything">
          <Slider value={look.grain} min={0} max={0.4} step={0.01} label="Grain" className="w-48" onChange={(grain) => set({ grain })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{Math.round(look.grain * 100)}%</span>
        </Row>
        <Row label="Window titles">
          <Segmented
            value={look.titlebar}
            onChange={(titlebar) => set({ titlebar })}
            options={[
              { value: "bar", label: "Bar ■■■" },
              { value: "line", label: "Thin" },
              { value: "none", label: "None" },
            ]}
          />
        </Row>
        <Row label="Accent from album art" hint="Off keeps everything black and white">
          <Toggle checked={look.artAccent} onChange={(artAccent) => set({ artAccent })} label="Accent from album art" />
        </Row>
      </Group>

      <Group id="type" title="Type">
        <FontChoice label="Text" value={look.font} onChange={(font) => set({ font })} />
        <FontChoice label="Headings" value={look.display} onChange={(display) => set({ display })} />
        <FontChoice label="Numbers and code" value={look.mono} onChange={(mono) => set({ mono })} />
        <Row label="Text weight" hint="Thin, rice-style text or a heavier, punchier look">
          <Slider value={fx.weight} min={300} max={600} step={50} label="Text weight" className="w-48" onChange={(weight) => setFx({ weight })} />
        </Row>
        <Row label="Interface size" hint="Scales text and controls everywhere">
          <Slider value={look.scale} min={0.8} max={1.3} step={0.05} label="Interface size" className="w-48" onChange={(scale) => set({ scale })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{Math.round(look.scale * 100)}%</span>
        </Row>
      </Group>

      <Group id="wallpaper" title="Wallpaper" description="Pick any picture, GIF or video you imported, then drag and zoom it until the part you like shows.">
        {deskWall && layout && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 text-[13px] text-fg-2">
            <span>“{layout.name}” has its own wallpaper, so changes here only affect that desk.</span>
            <Button size="sm" variant="ghost" onClick={() => useDesk.getState().update((x) => ({ ...x, wallpaper: null }), false)}>
              Use the look's wallpaper instead
            </Button>
          </div>
        )}
        <div className="p-4">
          <AssetLibrary columns={6} selected={wp.asset} onPick={(a) => setWp({ asset: a.id })} videos />
          {wp.asset && (
            <button onClick={() => setWp({ asset: null })} className="mt-2 text-xs text-fg-3 hover:text-fg-0">
              Remove wallpaper
            </button>
          )}
        </div>
        {wp.asset && (
          <div className="px-5 py-4">
            <div className="mb-0.5 text-[14px] font-medium text-fg-0">Size and position</div>
            <div className="mb-3 text-[13px] text-fg-2">If only part of your picture shows, zoom out until all of it fits.</div>
            <div className="max-w-[480px]">
              <WallpaperFramer wp={wp} onChange={setWp} />
            </div>
          </div>
        )}
        <Row label="Fit" hint="Fill covers the whole screen, Whole shows the entire picture, Tile repeats it">
          <Segmented value={wp.fit} onChange={(fit) => setWp({ fit })} options={[{ value: "cover", label: "Fill" }, { value: "contain", label: "Whole" }, { value: "tile", label: "Tile" }]} />
        </Row>
        <Row label="Darken">
          <Slider value={wp.dim} min={0} max={0.95} step={0.05} label="Darken wallpaper" className="w-48" onChange={(dim) => setWp({ dim })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{Math.round(wp.dim * 100)}%</span>
        </Row>
        <Row label="Blur">
          <Slider value={wp.blur} min={0} max={40} step={1} label="Blur wallpaper" className="w-48" onChange={(blur) => setWp({ blur })} />
          <span className="w-12 text-right text-sm tabular text-fg-1">{wp.blur}px</span>
        </Row>
        <Row label="Black and white" hint="Keeps colorful pictures in ink tones">
          <Toggle checked={wp.mono} onChange={(mono) => setWp({ mono })} label="Black and white wallpaper" />
        </Row>
      </Group>

      <Group id="effects" title="Effects" description="Living touches on top of your wallpaper. They pause when Karasu is hidden and turn off with Animations: Off.">
        <Row label="Music visual" hint={SCENES.find((s) => s.value === fx.scene)?.hint ?? "A full-screen picture that moves with whatever is playing"}>
          <Choice
            label="Music visual"
            value={fx.scene}
            onChange={(scene) => setFx({ scene: scene as Fx["scene"] })}
            options={[{ value: "none", label: "None" }, ...SCENES.map((s) => ({ value: s.value, label: s.label, hint: s.hint }))]}
          />
        </Row>
        {fx.scene !== "none" && (
          <>
            <Row label="Strength">
              <Slider value={fx.sceneStrength} min={0.15} max={1} step={0.05} label="Music visual strength" className="w-48" onChange={(sceneStrength) => setFx({ sceneStrength })} />
              <span className="w-12 text-right text-sm tabular text-fg-1">{Math.round(fx.sceneStrength * 100)}%</span>
            </Row>
            <Row label="Follow the music" hint="How hard it reacts to beats and loud parts">
              <Slider value={fx.sceneSense} min={0.4} max={2.5} step={0.05} label="Music visual sensitivity" className="w-48" onChange={(sceneSense) => setFx({ sceneSense })} />
            </Row>
            <Row label="Visual color">
              <Segmented
                value={fx.sceneColor}
                onChange={(sceneColor) => setFx({ sceneColor })}
                options={[
                  { value: "ink", label: "Ink" },
                  { value: "accent", label: "Accent" },
                  { value: "art", label: "Album art" },
                ]}
              />
            </Row>
          </>
        )}
        <Row label="Weather" hint="Drifting particles behind your windows">
          <Choice
            label="Weather"
            value={fx.particles}
            onChange={(particles) => setFx({ particles: particles as Fx["particles"] })}
            options={[
              { value: "none", label: "None" },
              { value: "snow", label: "Snow" },
              { value: "rain", label: "Rain" },
              { value: "sakura", label: "Falling petals" },
              { value: "fireflies", label: "Fireflies" },
              { value: "dust", label: "Ink dust" },
              { value: "stars", label: "Stars" },
            ]}
          />
        </Row>
        {fx.particles !== "none" && (
          <>
            <Row label="Amount">
              <Slider value={fx.density} min={0.3} max={2.5} step={0.1} label="Particle amount" className="w-48" onChange={(density) => setFx({ density })} />
            </Row>
            <Row label="Speed">
              <Slider value={fx.speed} min={0.3} max={2.5} step={0.1} label="Particle speed" className="w-48" onChange={(speed) => setFx({ speed })} />
            </Row>
            <Row label="Move with the music" hint="Particles speed up and glow on loud parts">
              <Toggle checked={fx.react} onChange={(react) => setFx({ react })} label="Move with the music" />
            </Row>
          </>
        )}
        <Row label="Wallpaper motion">
          <Choice
            label="Wallpaper motion"
            value={fx.wallMotion}
            onChange={(wallMotion) => setFx({ wallMotion: wallMotion as Fx["wallMotion"] })}
            options={[
              { value: "none", label: "Still" },
              { value: "drift", label: "Slow drift" },
              { value: "parallax", label: "Follows the mouse" },
              { value: "pulse", label: "Pulses with the music" },
            ]}
          />
        </Row>
        <Row label="Wallpaper slideshow" hint="Cycles through the large pictures you imported">
          <Choice
            label="Wallpaper slideshow"
            value={String(fx.slideshow)}
            onChange={(v) => setFx({ slideshow: Number(v) })}
            options={[
              { value: "0", label: "Off" },
              { value: "1", label: "Every minute" },
              { value: "5", label: "Every 5 minutes" },
              { value: "15", label: "Every 15 minutes" },
              { value: "60", label: "Every hour" },
            ]}
          />
        </Row>
        <Row label="Screen texture">
          <Segmented
            value={fx.overlay}
            onChange={(overlay) => setFx({ overlay })}
            options={[
              { value: "none", label: "None" },
              { value: "scanlines", label: "Scanlines" },
              { value: "vignette", label: "Vignette" },
              { value: "crt", label: "CRT" },
            ]}
          />
        </Row>
      </Group>

      <Group id="cursor" title="Cursor" description="Pick a style, or turn any picture or GIF you imported into your cursor.">
        <Row label="Style">
          <Segmented
            value={fx.cursor}
            onChange={(cursor) => setFx({ cursor })}
            options={[
              { value: "default", label: "System" },
              { value: "dot", label: "Ink dot" },
              { value: "cross", label: "Cross" },
              { value: "ring", label: "Ring" },
              { value: "image", label: "Your picture" },
            ]}
          />
        </Row>
        {fx.cursor === "image" && (
          <>
            <div className="px-5 py-4">
              <div className="mb-2 text-[14px] font-medium text-fg-0">Picture</div>
              <AssetLibrary columns={10} selected={fx.cursorAsset} onPick={(a) => setFx({ cursorAsset: a.id })} allowDelete={false} />
              {!fx.cursorAsset && <p className="mt-2 text-[13px] text-fg-2">Pick a picture to use it as your cursor. Small pictures with a see-through background work best.</p>}
            </div>
            <Row label="Over links and buttons" hint="Swap to a second picture when the cursor is over something you can click">
              <Segmented
                value={fx.cursorHover ? "other" : "same"}
                onChange={(v) => setFx({ cursorHover: v === "same" ? null : (fx.cursorHover ?? fx.cursorAsset) })}
                options={[
                  { value: "same", label: "Same picture" },
                  { value: "other", label: "Another picture" },
                ]}
              />
            </Row>
            {fx.cursorHover && (
              <div className="px-5 pb-4">
                <AssetLibrary columns={10} selected={fx.cursorHover} onPick={(a) => setFx({ cursorHover: a.id })} allowDelete={false} />
              </div>
            )}
            <Row label="Size" hint="GIFs and sizes over 32 px are drawn by Karasu itself, so they can move and grow">
              <Slider value={fx.cursorSize} min={16} max={96} step={2} label="Cursor size" className="w-48" onChange={(cursorSize) => setFx({ cursorSize })} />
              <span className="w-12 text-right text-sm tabular text-fg-1">{fx.cursorSize}px</span>
            </Row>
            <Row label="Pointing spot" hint="Where your clicks land on the picture">
              <Segmented
                value={fx.cursorHot}
                onChange={(cursorHot) => setFx({ cursorHot })}
                options={[
                  { value: "tip", label: "Top-left tip" },
                  { value: "center", label: "Center" },
                ]}
              />
            </Row>
            <Row label="Ink" hint={INK_MODES.find((m) => m.value === fx.cursorInk)?.hint}>
              <Choice label="Cursor ink" value={fx.cursorInk} onChange={(cursorInk) => setFx({ cursorInk })} options={INK_MODES.map((m) => ({ value: m.value, label: m.label }))} />
            </Row>
            <Row label="Smooth follow" hint="The cursor glides a little behind the mouse">
              <Toggle checked={fx.cursorSmooth} onChange={(cursorSmooth) => setFx({ cursorSmooth })} label="Smooth follow" />
            </Row>
            <Row label="Pulse with the music">
              <Toggle checked={fx.cursorReact} onChange={(cursorReact) => setFx({ cursorReact })} label="Cursor pulses with the music" />
            </Row>
          </>
        )}
        <Row label="Trail" hint="Works with every cursor style">
          <Choice
            label="Cursor trail"
            value={fx.cursorTrail}
            onChange={(cursorTrail) => setFx({ cursorTrail })}
            options={[
              { value: "none", label: "No trail" },
              { value: "ink", label: "Ink brush" },
              { value: "comet", label: "Comet" },
              { value: "sparkle", label: "Sparkles" },
              { value: "ripple", label: "Ripple on click" },
            ]}
          />
        </Row>
      </Group>

      <Group id="layout" title="Layout and motion">
        <Row label="Dock labels" hint="Words under the dock icons">
          <Toggle checked={look.dockLabels} onChange={(dockLabels) => set({ dockLabels })} label="Dock labels" />
        </Row>
        <Row label="Dock side">
          <Segmented value={fx.dock} onChange={(dock) => setFx({ dock })} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} />
        </Row>
        <Row label="Dock size">
          <Segmented
            value={fx.dockSize}
            onChange={(dockSize) => setFx({ dockSize })}
            options={[
              { value: "compact", label: "Compact" },
              { value: "normal", label: "Normal" },
              { value: "large", label: "Large" },
            ]}
          />
        </Row>
        <Row label="Top bar clock">
          <Segmented value={fx.clock24 ? "24" : "12"} onChange={(v) => setFx({ clock24: v === "24" })} options={[{ value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]} />
          <Toggle checked={fx.clockDate} onChange={(clockDate) => setFx({ clockDate })} label="Show the date" />
        </Row>
        <Row label="Song lists" hint="Compact fits more songs on screen">
          <Segmented value={fx.listDensity} onChange={(listDensity) => setFx({ listDensity })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </Row>
        <Row label="Why each song is here" hint="The little reason line under suggestions. Same on every desk">
          <Toggle checked={prefs.reasons} onChange={(reasons) => prefs.set({ reasons })} label="Show reasons" />
        </Row>
        <Row label="Album covers">
          <Segmented
            value={fx.covers}
            onChange={(covers) => setFx({ covers })}
            options={[
              { value: "square", label: "Square" },
              { value: "rounded", label: "Rounded" },
              { value: "round", label: "Round" },
            ]}
          />
        </Row>
        <Row label="Now Playing artwork">
          <Segmented
            value={fx.npArt}
            onChange={(npArt) => setFx({ npArt })}
            options={[
              { value: "cover", label: "Cover" },
              { value: "vinyl", label: "Spinning vinyl" },
              { value: "cd", label: "CD" },
            ]}
          />
        </Row>
        <Row label="Player bar">
          <Segmented value={fx.playerStyle} onChange={(playerStyle) => setFx({ playerStyle })} options={[{ value: "floating", label: "Floating" }, { value: "docked", label: "Docked" }]} />
        </Row>
        <Row label="Visualizer in Now Playing">
          <Toggle checked={fx.npViz} onChange={(npViz) => setFx({ npViz })} label="Visualizer" />
        </Row>
        <Row label="Visualizer style" hint="Desk visualizers have their own style in Arrange → element">
          <Choice label="Visualizer style" value={fx.vizStyle} onChange={(vizStyle) => setFx({ vizStyle })} options={VIZ_STYLES.map((v) => ({ value: v.value, label: v.label }))} />
        </Row>
        <Row label="Animations" hint="Reduced keeps transitions short; Off removes motion entirely. Same on every desk">
          <Segmented
            value={prefs.motion}
            onChange={(motion) => prefs.set({ motion })}
            options={[
              { value: "full", label: "Full" },
              { value: "reduced", label: "Reduced" },
              { value: "off", label: "Off" },
            ]}
          />
        </Row>
      </Group>

      <Group id="css" title="Custom CSS" description="For tinkerers: anything you write here is applied on top of Karasu and saved with your look. Clear it if something breaks.">
        <div className="p-4">
          <textarea
            value={fx.css}
            onChange={(e) => setFx({ css: e.target.value })}
            spellCheck={false}
            placeholder={".glass { border-radius: 0 !important; }"}
            className="h-40 w-full resize-y rounded-md bg-bg-3 p-3 font-mono text-[12px] leading-relaxed text-fg-0 outline-none hairline placeholder:text-fg-3"
          />
        </div>
      </Group>
    </>
  );
}
