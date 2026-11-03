import { useDeferredValue, useState } from "react";
import { Popover } from "radix-ui";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { api } from "../../lib/api";
import type { Seed } from "../../lib/types";
import { AlbumArt } from "../music/AlbumArt";
import { cn } from "../ui/cn";

const itemClass =
  "flex h-11 cursor-default select-none items-center gap-3 rounded-lg px-2 text-[13px] text-fg-1 outline-none data-[selected=true]:bg-bg-4 data-[selected=true]:text-fg-0";

export function SeedPicker({
  kinds,
  onPick,
  placeholder,
  className,
}: {
  kinds: ("track" | "artist" | "album")[];
  onPick: (seed: Seed) => void;
  placeholder: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const q = useDeferredValue(text.trim());
  const { data } = useQuery({
    queryKey: ["suggest", q],
    queryFn: ({ signal }) => api.suggest(q, signal),
    enabled: open && q.length > 0,
    placeholderData: (p) => p,
  });
  const pick = (seed: Seed) => {
    onPick(seed);
    setOpen(false);
    setText("");
  };
  return (
    <Popover.Root open={open && q.length > 0} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn("relative flex h-11 items-center gap-2.5 rounded-xl bg-bg-2 px-3.5 hairline focus-within:shadow-[inset_0_0_0_1px_var(--accent)]", className)}>
          <Search size={16} className="text-fg-3" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="h-full flex-1 bg-transparent text-sm text-fg-0 outline-none placeholder:text-fg-3"
          />
          {text && (
            <button aria-label="Clear" onClick={() => setText("")} className="text-fg-3 hover:text-fg-0">
              <X size={15} />
            </button>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[70] w-[var(--radix-popover-trigger-width)] min-w-[360px] rounded-xl bg-bg-3 p-1.5 elevated data-[state=open]:animate-[menu-in_160ms_var(--ease-out)]"
        >
          <Command shouldFilter={false}>
            <Command.List className="scroll-area max-h-80">
              {kinds.includes("track") &&
                data?.tracks.map((t) => (
                  <Command.Item
                    key={t.id}
                    value={t.id}
                    onSelect={() => pick({ type: "track", value: t.id, label: `${t.title} — ${t.artist.name}`, art: t.art })}
                    className={itemClass}
                  >
                    <AlbumArt art={t.art} seed={t.id} size={32} className="h-8 w-8" rounded="rounded-md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-fg-0">{t.title}</div>
                      <div className="truncate text-xs text-fg-2">{t.artist.name}</div>
                    </div>
                    <span className="text-2xs uppercase tracking-wider text-fg-3">Song</span>
                  </Command.Item>
                ))}
              {kinds.includes("artist") &&
                data?.artists.map((a) => (
                  <Command.Item
                    key={a.dz_id}
                    value={`a${a.dz_id}`}
                    onSelect={() => pick({ type: "artist", value: String(a.dz_id), label: a.name, art: a.art })}
                    className={itemClass}
                  >
                    <AlbumArt art={a.art} seed={a.name} size={32} className="h-8 w-8" rounded="rounded-full" />
                    <span className="flex-1 truncate font-medium text-fg-0">{a.name}</span>
                    <span className="text-2xs uppercase tracking-wider text-fg-3">Artist</span>
                  </Command.Item>
                ))}
              {kinds.includes("album") &&
                data?.albums.map((al) => (
                  <Command.Item
                    key={al.dz_id}
                    value={`al${al.dz_id}`}
                    onSelect={() => pick({ type: "album", value: String(al.dz_id), label: al.title, art: al.art })}
                    className={itemClass}
                  >
                    <AlbumArt art={al.art} seed={al.title} size={32} className="h-8 w-8" rounded="rounded-md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-fg-0">{al.title}</div>
                      <div className="truncate text-xs text-fg-2">{al.artist}</div>
                    </div>
                    <span className="text-2xs uppercase tracking-wider text-fg-3">Album</span>
                  </Command.Item>
                ))}
              {data && !data.tracks.length && !data.artists.length && (
                <div className="px-3 py-6 text-center text-sm text-fg-3">No matches in your library yet. Try another name.</div>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
