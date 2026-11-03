import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { useUi } from "../../store/ui";
import { Button } from "../ui/Button";
import { Mosaic } from "./AlbumArt";

export function AddToPlaylist() {
  const ids = useUi((s) => s.addToPlaylist);
  const set = useUi((s) => s.set);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["playlists"], queryFn: api.playlists, enabled: !!ids });
  const own = (data ?? []).filter((p) => p.editable && !p.id.startsWith("lane:"));
  const close = () => {
    set({ addToPlaylist: null });
    setName("");
  };

  const addTo = async (pid: string) => {
    if (!ids) return;
    setBusy(pid);
    try {
      await api.addToPlaylist(pid, ids);
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist", pid] });
      toast(`Added to ${own.find((p) => p.id === pid)?.name ?? "playlist"}`);
      close();
    } catch (e) {
      toast("Couldn't add to playlist", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!ids || !name.trim()) return;
    setBusy("new");
    try {
      try {
        const created = await api.createSpotifyPlaylist(name.trim(), ids);
        toast(`Created ${name.trim()} in Spotify`, { description: created.matched < created.total ? `${created.matched} of ${created.total} songs are on Spotify` : undefined });
      } catch (spotifyError) {
        const created = await api.createPlaylist({ name: name.trim(), track_ids: ids });
        toast(`Created ${created.name} in Karasu`, { description: `Spotify said: ${(spotifyError as Error).message}` });
      }
      qc.invalidateQueries({ queryKey: ["playlists"] });
      close();
    } catch (e) {
      toast("Couldn't create playlist", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog.Root open={!!ids} onOpenChange={(v) => !v && close()}>
      <AnimatePresence>
        {ids && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[75] bg-[var(--scrim)] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed left-1/2 top-1/2 z-[76] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-bg-2 p-5 elevated"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              >
                <Dialog.Title className="text-lg font-semibold">Add {ids.length === 1 ? "song" : `${ids.length} songs`} to playlist</Dialog.Title>
                <div className="mt-4 flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && create()}
                    placeholder="New playlist name"
                    className="h-10 flex-1 rounded-lg bg-bg-3 px-3 text-sm text-fg-0 outline-none hairline placeholder:text-fg-3 focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                  />
                  <Button variant="primary" onClick={create} disabled={!name.trim() || busy === "new"} icon={<Plus size={16} />}>
                    Create
                  </Button>
                </div>
                <div className="scroll-area mt-4 max-h-72 space-y-1">
                  {own.length === 0 && <p className="py-6 text-center text-sm text-fg-3">No playlists yet — create your first one above.</p>}
                  {own.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addTo(p.id)}
                      disabled={!!busy}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-bg-3"
                    >
                      <Mosaic arts={p.art ?? []} size={44} className="h-11 w-11 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg-0">{p.name}</div>
                        <div className="text-xs text-fg-3">
                          {p.kind === "spotify" ? "Spotify" : "Karasu"} · {p.count} songs
                        </div>
                      </div>
                      {busy === p.id && <Check size={16} className="text-accent" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
