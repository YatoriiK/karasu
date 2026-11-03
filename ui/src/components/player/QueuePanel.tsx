import { AnimatePresence, motion } from "motion/react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ListMusic, X } from "lucide-react";
import type { Track } from "../../lib/types";
import { currentTrack, usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { IconButton } from "../ui/Button";
import { EmptyState, Equalizer } from "../ui/states";
import { AlbumArt } from "../music/AlbumArt";
import { TrackContextMenu } from "../music/TrackMenu";

function QueueItem({ track, queueIndex }: { track: Track; queueIndex: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `${queueIndex}:${track.id}` });
  const removeAt = usePlayer((s) => s.removeAt);
  const jump = () => {
    const s = usePlayer.getState();
    s.playList(s.queue, queueIndex, s.context);
  };
  return (
    <TrackContextMenu track={track}>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`group flex items-center gap-2.5 rounded-lg p-1.5 pr-2 transition-colors ${isDragging ? "z-10 bg-bg-4 shadow-xl" : "hover:bg-bg-3"}`}
      >
        <button {...attributes} {...listeners} aria-label="Drag to reorder" className="cursor-grab text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing">
          <GripVertical size={15} />
        </button>
        <button onDoubleClick={jump} onClick={jump} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <AlbumArt art={track.art} seed={track.id} size={40} className="h-10 w-10" rounded="rounded-md" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-fg-0">{track.title}</div>
            <div className="truncate text-xs text-fg-2">{track.artist.name}</div>
          </div>
        </button>
        <IconButton label="Remove" size="sm" round className="opacity-0 group-hover:opacity-100" onClick={() => removeAt(queueIndex)}>
          <X size={14} />
        </IconButton>
      </div>
    </TrackContextMenu>
  );
}

export function QueuePanel() {
  const open = useUi((s) => s.queueOpen);
  const set = useUi((s) => s.set);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const now = usePlayer(currentTrack);
  const context = usePlayer((s) => s.context);
  const { move, clearUpcoming } = usePlayer.getState();
  const upcoming = queue.map((t, i) => ({ t, i })).filter(({ i }) => i > index);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = Number(String(e.active.id).split(":")[0]);
    const to = Number(String(e.over.id).split(":")[0]);
    move(from, to);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[64]"
            onClick={() => set({ queueOpen: false })}
          />
          <motion.aside
            key="queue"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed bottom-[100px] right-3 z-[65] flex w-[380px] flex-col overflow-hidden rounded-2xl bg-bg-2/95 elevated backdrop-blur-2xl"
            style={{ top: "calc(var(--titlebar-h) + 12px)" }}
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <h2 className="text-lg font-semibold">Queue</h2>
              <IconButton label="Close queue" size="sm" round onClick={() => set({ queueOpen: false })}>
                <X size={16} />
              </IconButton>
            </div>
            <div className="scroll-area min-h-0 flex-1 px-2.5 pb-4">
              {now ? (
                <>
                  <div className="px-1.5 pb-1.5 pt-2 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">Now playing</div>
                  <TrackContextMenu track={now}>
                    <div className="flex items-center gap-2.5 rounded-lg bg-bg-3/70 p-1.5">
                      <AlbumArt art={now.art} seed={now.id} size={44} className="h-11 w-11" rounded="rounded-md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-accent">{now.title}</div>
                        <div className="truncate text-xs text-fg-2">{now.artist.name}</div>
                      </div>
                      <Equalizer playing={playing} className="mr-2" />
                    </div>
                  </TrackContextMenu>
                  <div className="flex items-center justify-between px-1.5 pb-1.5 pt-5">
                    <span className="truncate text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">
                      Next{context ? ` from ${context.label}` : ""}
                    </span>
                    {upcoming.length > 0 && (
                      <button onClick={clearUpcoming} className="text-xs font-semibold text-fg-2 hover:text-fg-0">
                        Clear
                      </button>
                    )}
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={upcoming.map(({ t, i }) => `${i}:${t.id}`)} strategy={verticalListSortingStrategy}>
                      {upcoming.map(({ t, i }) => (
                        <QueueItem key={`${i}:${t.id}`} track={t} queueIndex={i} />
                      ))}
                    </SortableContext>
                  </DndContext>
                  {!upcoming.length && <p className="px-2 py-6 text-center text-sm text-fg-3">Nothing queued after this song.</p>}
                </>
              ) : (
                <EmptyState icon={<ListMusic size={22} />} title="Your queue is empty" body="Play something and it'll line up here." />
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
