import { useState } from "react";
import { Popover } from "radix-ui";
import { Heart, Pause, Pencil, Play, Repeat, Search, Shuffle, SkipBack, SkipForward, type LucideIcon } from "lucide-react";
import { AssetLibrary } from "../../desk/AssetLibrary";
import { DOCK } from "../../components/shell/Dock";
import { Logo } from "../../components/ui/states";
import { Button } from "../../components/ui/Button";
import { INK_MODES, SKIN_SLOTS, Skin, useSkins, type InkMode } from "../../theme/skins";
import { Group } from "./ui";
import { Settings2 } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  ...Object.fromEntries(DOCK.map((d) => [d.slot, d.icon])),
  "nav.settings": Settings2,
  "player.play": Play,
  "player.pause": Pause,
  "player.prev": SkipBack,
  "player.next": SkipForward,
  "player.shuffle": Shuffle,
  "player.repeat": Repeat,
  "player.like": Heart,
  "bar.search": Search,
  "bar.edit": Pencil,
};

function SlotTile({ id, label }: { id: string; label: string }) {
  const entry = useSkins((s) => s.skins[id]);
  const { setSkin, setMode } = useSkins.getState();
  const [open, setOpen] = useState(false);
  const Icon = ICONS[id];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="flex flex-col items-center gap-2 rounded-md bg-bg-3/60 px-2 py-3 text-fg-1 transition-colors hairline hover:bg-bg-4 hover:text-fg-0">
          <Skin slot={id} size={26}>
            {id === "bar.logo" ? <Logo size={26} /> : Icon ? <Icon size={22} /> : null}
          </Skin>
          <span className="text-[11.5px]">{label}</span>
          {entry && <span className="-mt-1 text-[10px] text-fg-3">custom</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} collisionPadding={12} className="z-[80] w-[340px] rounded-lg bg-bg-3 p-3 elevated">
          <div className="mb-2 text-[13px] font-semibold text-fg-0">{label} button</div>
          <AssetLibrary
            columns={4}
            selected={entry?.asset ?? null}
            allowDelete={false}
            onPick={(a) => setSkin(id, a.id)}
          />
          {entry && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {INK_MODES.map((m) => (
                  <button
                    key={m.value}
                    title={m.hint}
                    onClick={() => setMode(id, m.value as InkMode)}
                    className={
                      entry.mode === m.value
                        ? "rounded-sm bg-fg-0 px-2 py-1.5 text-[12px] text-bg-0"
                        : "rounded-sm bg-bg-2 px-2 py-1.5 text-[12px] text-fg-1 hover:bg-bg-4"
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSkin(id, null)}>
                Use the default icon
              </Button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ButtonSkins() {
  const groups = [...new Set(SKIN_SLOTS.map((s) => s.group))];
  const count = Object.keys(useSkins((s) => s.skins)).length;
  return (
    <Group
      id="buttons"
      title="Buttons"
      description="Swap any button for one of your pictures. Ink mode turns black-on-white art into icons that match your look."
    >
      {groups.map((g) => (
        <div key={g} className="p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-fg-3">{g}</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {SKIN_SLOTS.filter((s) => s.group === g).map((s) => (
              <SlotTile key={s.id} id={s.id} label={s.label} />
            ))}
          </div>
        </div>
      ))}
      {count > 0 && (
        <div className="p-4">
          <Button size="sm" variant="ghost" onClick={() => useSkins.getState().reset()}>
            Reset all {count} custom buttons
          </Button>
        </div>
      )}
    </Group>
  );
}
