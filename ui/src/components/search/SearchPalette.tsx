import { useDeferredValue, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ArrowRight, Clock3, Disc3, Search, Sparkles } from "lucide-react";
import { api } from "../../lib/api";
import { usePlayable, usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { AlbumArt } from "../music/AlbumArt";

const itemClass =
  "flex h-12 cursor-default select-none items-center gap-3 rounded-lg px-2.5 text-[14px] text-fg-1 outline-none transition-colors data-[selected=true]:bg-bg-4 data-[selected=true]:text-fg-0";

export function SearchPalette() {
  const open = useUi((s) => s.searchOpen);
  const canPlay = usePlayable();
  const set = useUi((s) => s.set);
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const deferred = useDeferredValue(text.trim());
  const { data, isFetching } = useQuery({
    queryKey: ["suggest", deferred],
    queryFn: ({ signal }) => api.suggest(deferred, signal),
    enabled: open,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ searchOpen: !useUi.getState().searchOpen });
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        set({ searchOpen: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const close = () => set({ searchOpen: false });
  const go = (path: string) => {
    close();
    navigate(path);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => set({ searchOpen: v })}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[75] bg-[var(--scrim)] backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed left-1/2 top-[12vh] z-[76] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl bg-bg-2 elevated"
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.985, transition: { duration: 0.14 } }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              >
                <Dialog.Title className="sr-only">Search</Dialog.Title>
                <Command shouldFilter={false} loop>
                  <div className="flex items-center gap-3 border-b border-line px-4">
                    <Search size={18} className={isFetching ? "animate-pulse text-accent" : "text-fg-2"} />
                    <Command.Input
                      autoFocus
                      value={text}
                      onValueChange={setText}
                      placeholder="Songs, artists, albums — or describe a sound"
                      className="h-14 flex-1 bg-transparent text-[16px] text-fg-0 outline-none placeholder:text-fg-3"
                    />
                    <kbd className="rounded-md bg-bg-4 px-1.5 py-0.5 text-2xs font-semibold text-fg-2">Esc</kbd>
                  </div>
                  <Command.List className="scroll-area max-h-[min(60vh,520px)] p-2">
                    {deferred && (
                      <Command.Group>
                        <Command.Item value="__all" onSelect={() => go(`/search?q=${encodeURIComponent(deferred)}`)} className={itemClass}>
                          <span className="grid h-8 w-8 place-items-center rounded-md bg-bg-4 text-fg-1">
                            <Search size={15} />
                          </span>
                          <span className="flex-1 truncate">
                            Search everything for <span className="font-semibold text-fg-0">“{deferred}”</span>
                          </span>
                          <ArrowRight size={15} className="text-fg-3" />
                        </Command.Item>
                        <Command.Item value="__vibe" onSelect={() => go(`/search?q=${encodeURIComponent(deferred)}&vibe=1`)} className={itemClass}>
                          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent-soft text-accent">
                            <Sparkles size={15} />
                          </span>
                          <span className="flex-1 truncate">
                            Find songs that <span className="font-semibold text-fg-0">sound like “{deferred}”</span>
                          </span>
                          <ArrowRight size={15} className="text-fg-3" />
                        </Command.Item>
                      </Command.Group>
                    )}
                    {!deferred && (data?.recent?.length ?? 0) > 0 && (
                      <Command.Group heading="Recent searches" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-fg-3">
                        {data!.recent.map((r) => (
                          <Command.Item key={r} value={`r:${r}`} onSelect={() => go(`/search?q=${encodeURIComponent(r)}`)} className={itemClass}>
                            <Clock3 size={15} className="text-fg-3" />
                            <span className="truncate">{r}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {(data?.tracks?.length ?? 0) > 0 && deferred && (
                      <Command.Group heading="Songs" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-fg-3">
                        {data!.tracks.map((t) => (
                          <Command.Item
                            key={t.id}
                            value={t.id}
                            onSelect={() => {
                              close();
                              usePlayer.getState().playTrack(t, { label: "Search" });
                            }}
                            className={itemClass}
                          >
                            <AlbumArt art={t.art} seed={t.id} size={36} className="h-9 w-9" rounded="rounded-md" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{t.title}</div>
                              <div className="truncate text-xs text-fg-2">{t.artist.name}</div>
                            </div>
                            <span className="text-xs text-fg-3">{canPlay(t) ? "Play" : "No preview"}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {(data?.artists?.length ?? 0) > 0 && deferred && (
                      <Command.Group heading="Artists" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-fg-3">
                        {data!.artists.map((a) => (
                          <Command.Item key={a.dz_id} value={`a:${a.dz_id}`} onSelect={() => go(`/artist/${a.dz_id}`)} className={itemClass}>
                            <AlbumArt art={a.art} seed={a.name} size={36} className="h-9 w-9" rounded="rounded-full" />
                            <span className="flex-1 truncate font-medium">{a.name}</span>
                            <span className="text-xs text-fg-3">Artist</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {(data?.albums?.length ?? 0) > 0 && deferred && (
                      <Command.Group heading="Albums" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-fg-3">
                        {data!.albums.map((al) => (
                          <Command.Item key={al.dz_id} value={`al:${al.dz_id}`} onSelect={() => go(`/album/${al.dz_id}`)} className={itemClass}>
                            {al.art ? (
                              <AlbumArt art={al.art} seed={al.title} size={36} className="h-9 w-9" rounded="rounded-md" />
                            ) : (
                              <span className="grid h-9 w-9 place-items-center rounded-md bg-bg-4">
                                <Disc3 size={16} />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{al.title}</div>
                              <div className="truncate text-xs text-fg-2">{al.artist}</div>
                            </div>
                            <span className="text-xs text-fg-3">Album</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {!deferred && !(data?.recent?.length ?? 0) && (
                      <div className="px-4 py-10 text-center text-sm text-fg-3">
                        Search your library and the whole Deezer catalog, or describe a sound like
                        <span className="text-fg-1"> “warm 70s soul with strings”</span>.
                      </div>
                    )}
                  </Command.List>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
