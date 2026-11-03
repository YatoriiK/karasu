import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ContextMenu } from "radix-ui";
import { Check, Eye, Layers, Magnet, Monitor, Pencil, Plus, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { assetUrl, fontStack, useLook, type Look } from "../theme/look";
import { cn } from "../components/ui/cn";
import { Skeleton } from "../components/ui/states";
import { angleFrom, guides, moveRect, resizeRect, sortedByZ } from "./geometry";
import { WIDGET, resolvedStyle, type WidgetDef } from "./registry";
import { useActiveLayout, useDesk } from "./store";
import type { DeskData, Handle, Item, ItemStyle } from "./types";
import { Panels } from "./Panels";
import { FrameContext } from "./frame";

const SHADOWS: Record<string, string> = {
  none: "none",
  soft: "0 24px 60px -24px rgb(0 0 0 / 0.7), 0 4px 14px -6px rgb(0 0 0 / 0.45)",
  hard: "6px 6px 0 0 rgb(0 0 0 / 0.3)",
  glow: "0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent), 0 0 32px -6px color-mix(in srgb, var(--ink) calc(var(--glow) * 30%), transparent)",
};

function frameCss(s: ItemStyle, look: Look): CSSProperties {
  const alpha = s.surface != null ? `${Math.round(s.surface * 100)}%` : "var(--surface-alpha)";
  const bg = s.bg ?? "inherit";
  const blur = s.blur ?? look.blur;
  const css: CSSProperties = {
    borderRadius: `${s.radius ?? look.radius}px`,
    borderWidth: `${s.border ?? look.border}px`,
    borderStyle: s.borderStyle ?? "solid",
    borderColor: s.borderColor ?? "var(--border-c)",
    boxShadow: !s.shadow || s.shadow === "inherit" ? "var(--shadow-win)" : SHADOWS[s.shadow],
  };
  if (bg === "none") css.background = "transparent";
  else if (bg === "image" && s.bgImage) {
    const dim = Math.round((s.bgDim ?? 0.35) * 100);
    css.backgroundImage = `linear-gradient(color-mix(in srgb, var(--paper) ${dim}%, transparent), color-mix(in srgb, var(--paper) ${dim}%, transparent)), url("${assetUrl(s.bgImage, 1280)}")`;
    css.backgroundSize = s.bgFit ?? "cover";
    css.backgroundPosition = "center";
    css.backgroundRepeat = "no-repeat";
  } else {
    css.background = `color-mix(in srgb, ${bg === "color" ? (s.bgColor ?? look.surface) : "var(--surface)"} ${alpha}, transparent)`;
  }
  if (bg !== "none" && blur > 0) {
    css.backdropFilter = `blur(${blur}px)`;
    css.WebkitBackdropFilter = `blur(${blur}px)`;
  }
  if (s.font) css.fontFamily = fontStack(s.font);
  // Widgets color their text with the theme's --fg-* shades, so a plain `color` here never shows.
  // Re-point the shades instead, and every label inside follows.
  if (s.color) {
    const ink = s.color;
    Object.assign(css, {
      color: ink,
      "--ink": ink,
      "--fg-0": ink,
      "--fg-1": `color-mix(in srgb, ${ink} 84%, var(--surface))`,
      "--fg-2": `color-mix(in srgb, ${ink} 70%, var(--surface))`,
      "--fg-3": `color-mix(in srgb, ${ink} 58%, var(--surface))`,
      "--line": `color-mix(in srgb, ${ink} 12%, transparent)`,
      "--line-strong": `color-mix(in srgb, ${ink} 22%, transparent)`,
    });
  }
  return css;
}

function TitleBar({ mode, title }: { mode: "bar" | "line"; title: string }) {
  if (mode === "bar")
    return (
      <div className="flex h-[30px] shrink-0 items-center bg-fg-0 px-3 text-bg-0">
        <span className="w-[46px]" />
        <span className="flex-1 truncate text-center font-mono text-[12px]">{title}</span>
        <span className="flex w-[46px] justify-end gap-[5px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <i key={i} className="block h-[10px] w-[10px] bg-bg-0" />
          ))}
        </span>
      </div>
    );
  return (
    <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line px-3">
      <span className="flex-1 truncate font-mono text-[11px] lowercase tracking-[0.12em] text-fg-2">{title}</span>
      <span className="flex gap-[5px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <i key={i} className="block h-[7px] w-[7px] border border-fg-2/60" />
        ))}
      </span>
    </div>
  );
}

export function ItemFrame({ item, def, look, children }: { item: Item; def: WidgetDef; look: Look; children: ReactNode }) {
  const s = resolvedStyle(item, def);
  const titlebar = !s.titlebar || s.titlebar === "inherit" ? look.titlebar : s.titlebar;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden text-fg-0" style={frameCss(s, look)}>
      {titlebar !== "none" && <TitleBar mode={titlebar} title={item.name || def.title} />}
      <div className="relative min-h-0 flex-1 [container-type:size]" style={{ padding: s.padding ?? 14, fontSize: `${13 * (s.scale ?? 1)}px` }}>
        <FrameContext.Provider value={{ titled: titlebar !== "none" }}>{children}</FrameContext.Provider>
      </div>
    </div>
  );
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Handle, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
};

type Guides = { x: number | null; y: number | null } | null;

function track(onMove: (e: PointerEvent) => void, onUp?: () => void) {
  const up = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp?.();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

function ItemMenu({ item, children }: { item: Item; children: ReactNode }) {
  const d = useDesk.getState();
  const entry = "flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2.5 text-[13px] text-fg-1 outline-none data-[highlighted]:bg-bg-4 data-[highlighted]:text-fg-0";
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[90] min-w-[200px] rounded-md bg-bg-3 p-1 font-mono elevated">
          <ContextMenu.Item className={entry} onSelect={() => d.restack(item.id, "front")}>Bring to front</ContextMenu.Item>
          <ContextMenu.Item className={entry} onSelect={() => d.restack(item.id, "up")}>Bring forward</ContextMenu.Item>
          <ContextMenu.Item className={entry} onSelect={() => d.restack(item.id, "down")}>Send backward</ContextMenu.Item>
          <ContextMenu.Item className={entry} onSelect={() => d.restack(item.id, "back")}>Send to back</ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-line" />
          <ContextMenu.Item className={entry} onSelect={() => d.duplicateItem(item.id)}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item className={entry} onSelect={() => d.updateItem(item.id, { hidden: !item.hidden })}>{item.hidden ? "Show" : "Hide"}</ContextMenu.Item>
          <ContextMenu.Item className={entry} onSelect={() => d.updateItem(item.id, { locked: !item.locked })}>{item.locked ? "Unlock" : "Lock"}</ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-line" />
          <ContextMenu.Item className={cn(entry, "text-bad data-[highlighted]:text-bad")} onSelect={() => d.removeItem(item.id)}>
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function activeData(): DeskData | undefined {
  const d = useDesk.getState();
  return d.layouts.find((l) => l.id === d.activeId)?.data;
}

const EditOverlay = memo(function EditOverlay({
  item,
  def,
  scale,
  selected,
  setGuides,
}: {
  item: Item;
  def: WidgetDef;
  scale: number;
  selected: boolean;
  setGuides: (g: Guides) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const rect = { x: item.x, y: item.y, w: item.w, h: item.h, r: item.r };
  const hs = 10 / scale;

  const onMove = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = useDesk.getState();
    store.select(item.id);
    const data = activeData();
    if (item.locked || !data) return;
    const snapOn = data.snap !== false;
    const sx = e.clientX;
    const sy = e.clientY;
    const others = data.items.filter((i) => i.id !== item.id && !i.hidden);
    let moved = false;
    track(
      (ev) => {
        const dx = (ev.clientX - sx) / scale;
        const dy = (ev.clientY - sy) / scale;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        if (!moved) {
          store.checkpoint();
          moved = true;
        }
        const next = moveRect(rect, dx, dy, data.grid, snapOn && !ev.altKey);
        if (!ev.altKey && item.r === 0) {
          const g = guides(next, others, data.canvas, 6 / scale);
          next.x += g.dx;
          next.y += g.dy;
          setGuides({ x: g.x, y: g.y });
        }
        store.updateItem(item.id, { x: Math.round(next.x), y: Math.round(next.y) }, false);
      },
      () => setGuides(null),
    );
  };

  const onResize = (handle: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const store = useDesk.getState();
    const data = activeData();
    if (!data) return;
    const snapOn = data.snap !== false;
    store.checkpoint();
    const sx = e.clientX;
    const sy = e.clientY;
    track((ev) => {
      const next = resizeRect(rect, handle, (ev.clientX - sx) / scale, (ev.clientY - sy) / scale, {
        min: def.min,
        keepRatio: ev.shiftKey || (def.kind === "image" && !ev.altKey && handle.length === 2),
        grid: data.grid,
        snap: snapOn && !ev.altKey,
      });
      store.updateItem(item.id, { x: next.x, y: next.y, w: next.w, h: next.h }, false);
    });
  };

  const onRotate = (e: ReactPointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const store = useDesk.getState();
    store.checkpoint();
    const b = box.current?.parentElement?.getBoundingClientRect();
    if (!b) return;
    const center = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    track((ev) => store.updateItem(item.id, { r: angleFrom(center, { x: ev.clientX, y: ev.clientY }, ev.shiftKey ? 15 : undefined) }, false));
  };

  return (
    <ItemMenu item={item}>
      <div ref={box} className={cn("absolute inset-0", item.locked ? "cursor-default" : "cursor-move")} onPointerDown={onMove}>
        <div
          className={cn(
            "pointer-events-none absolute inset-0 transition-[outline-color] duration-100",
            selected ? "outline outline-[1.5px] outline-fg-0" : "outline outline-1 outline-dashed outline-fg-0/0 hover:outline-fg-0/45",
          )}
          style={{ outlineOffset: 2 / scale }}
        />
        {selected && !item.locked && (
          <>
            {HANDLES.map((h) => (
              <div
                key={h}
                data-handle={h}
                onPointerDown={onResize(h)}
                className={cn("absolute z-10 border border-bg-0 bg-fg-0", HANDLE_POS[h])}
                style={{ width: hs, height: hs, borderWidth: 1 / scale }}
              />
            ))}
            {def.rotatable && (
              <div
                data-handle="rotate"
                onPointerDown={onRotate}
                title="Rotate (Shift snaps to 15°)"
                className="absolute left-1/2 z-10 -translate-x-1/2 cursor-grab rounded-full border border-bg-0 bg-fg-0"
                style={{ top: -28 / scale, width: hs * 1.2, height: hs * 1.2, borderWidth: 1 / scale }}
              />
            )}
          </>
        )}
        {selected && (
          <div
            className="pointer-events-none absolute left-0 whitespace-nowrap bg-fg-0 font-mono text-bg-0"
            style={{ top: `calc(100% + ${6 / scale}px)`, fontSize: 11 / scale, padding: `${1 / scale}px ${5 / scale}px` }}
          >
            {item.locked ? "locked · " : ""}
            {Math.round(item.w)} × {Math.round(item.h)}
            {item.r ? ` · ${Math.round(item.r)}°` : ""}
          </div>
        )}
      </div>
    </ItemMenu>
  );
});

const DeskItem = memo(function DeskItem({
  item,
  look,
  editing,
  selected,
  scale,
  setGuides,
}: {
  item: Item;
  look: Look;
  editing: boolean;
  selected: boolean;
  scale: number;
  setGuides: (g: Guides) => void;
}) {
  const def = WIDGET[item.kind];
  if (!def || (item.hidden && !editing)) return null;
  const Component = def.Component;
  return (
    <div
      data-desk-item={item.id}
      className={cn("absolute", item.hidden && "opacity-25")}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, transform: item.r ? `rotate(${item.r}deg)` : undefined, zIndex: item.z, opacity: item.hidden ? 0.25 : (item.style.opacity ?? 1) }}
    >
      <div className={cn("h-full w-full", editing && "pointer-events-none select-none")}>
        <ItemFrame item={item} def={def} look={look}>
          <Component item={item} editing={editing} />
        </ItemFrame>
      </div>
      {editing && <EditOverlay item={item} def={def} scale={scale} selected={selected} setGuides={setGuides} />}
    </div>
  );
});

function Toolbar() {
  const d = useDesk();
  const layout = useActiveLayout();
  const snapOn = layout?.data.snap !== false;
  const btn = "flex h-8 items-center gap-1.5 rounded-pill px-3 text-[12px] text-fg-1 transition-colors hover:bg-fg-0/10 hover:text-fg-0 disabled:opacity-35";
  return (
    <motion.div
      initial={{ y: -14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -14, opacity: 0 }}
      className="glass absolute left-1/2 top-3 z-[60] flex -translate-x-1/2 items-center gap-0.5 rounded-pill p-1 font-mono"
    >
      <button className={cn(btn, d.panel === "add" && "bg-fg-0/10 text-fg-0")} onClick={() => d.setPanel("add")}>
        <Plus size={14} /> add
      </button>
      <button className={cn(btn, d.panel === "layers" && "bg-fg-0/10 text-fg-0")} onClick={() => d.setPanel("layers")}>
        <Layers size={14} /> layers
      </button>
      <button className={cn(btn, d.panel === "desk" && "bg-fg-0/10 text-fg-0")} onClick={() => d.setPanel("desk")}>
        <Monitor size={14} /> desk
      </button>
      <span className="mx-1 h-5 w-px bg-line-strong" />
      <button className={btn} aria-label="Undo" disabled={!d.past.length} onClick={d.undo}>
        <Undo2 size={14} />
      </button>
      <button className={btn} aria-label="Redo" disabled={!d.future.length} onClick={d.redo}>
        <Redo2 size={14} />
      </button>
      <button
        className={cn(btn, snapOn && "text-fg-0")}
        aria-pressed={snapOn}
        title="Snap to grid and other elements (hold Alt to move freely)"
        onClick={() => d.update((data) => ({ ...data, snap: !snapOn }))}
      >
        <Magnet size={14} /> {snapOn ? "snap" : "free"}
      </button>
      <span className="mx-1 h-5 w-px bg-line-strong" />
      <span className="px-2 text-[11px] text-fg-3">{d.saving === "saving" ? "saving…" : d.saving === "error" ? "not saved" : "saved"}</span>
      <button className="flex h-8 items-center gap-1.5 rounded-pill bg-fg-0 px-3.5 text-[12px] font-bold text-bg-0" onClick={() => d.setEditing(false)}>
        <Check size={14} /> done
      </button>
    </motion.div>
  );
}

function useDeskKeys(editing: boolean) {
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const d = useDesk.getState();
      const id = d.selected;
      const layout = d.layouts.find((l) => l.id === d.activeId);
      const item = layout?.data.items.find((i) => i.id === id);
      const mod = e.ctrlKey || e.metaKey;
      let handled = true;
      if (mod && e.key.toLowerCase() === "z") (e.shiftKey ? d.redo : d.undo)();
      else if (mod && e.key.toLowerCase() === "y") d.redo();
      else if (mod && e.key.toLowerCase() === "d" && id) d.duplicateItem(id);
      else if (e.key === "Escape") id ? d.select(null) : d.setEditing(false);
      else if ((e.key === "Delete" || e.key === "Backspace") && id) d.removeItem(id);
      else if (e.key === "]" && id) d.restack(id, e.shiftKey ? "front" : "up");
      else if (e.key === "[" && id) d.restack(id, e.shiftKey ? "back" : "down");
      else if (e.key.startsWith("Arrow") && item && !item.locked) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        d.updateItem(item.id, { x: item.x + dx, y: item.y + dy });
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing]);
}

export async function addImages(files: File[], at?: { x: number; y: number }) {
  const d = useDesk.getState();
  const layout = d.layouts.find((l) => l.id === d.activeId);
  if (!layout) return;
  let offset = 0;
  for (const file of files.filter((f) => f.type.startsWith("image/") || f.type === "video/mp4" || f.type === "video/webm")) {
    try {
      const asset = await api.uploadAsset(file, file.name);
      const ratio = asset.w && asset.h ? asset.w / asset.h : 1;
      const w = Math.round(ratio >= 1 ? 360 : 360 * ratio);
      const h = Math.round(ratio >= 1 ? 360 / ratio : 360);
      const x = Math.round((at?.x ?? layout.data.canvas.w / 2) - w / 2 + offset);
      const y = Math.round((at?.y ?? layout.data.canvas.h / 2) - h / 2 + offset);
      d.addItem({ kind: "image", x, y, w, h, r: 0, style: {}, props: { asset: asset.id, fit: "contain", ink: asset.video ? "original" : "ink" } });
      offset += 24;
    } catch (error) {
      toast(`Couldn't add ${file.name}`, { description: (error as Error).message });
    }
  }
}

export function Desk() {
  const ready = useDesk((s) => s.ready);
  const editing = useDesk((s) => s.editing);
  const selected = useDesk((s) => s.selected);
  const layout = useActiveLayout();
  const look = useLook((s) => s.look);
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [guide, setGuide] = useState<Guides>(null);
  const [dropping, setDropping] = useState(false);
  useDeskKeys(editing);

  useEffect(() => {
    if (!ready) void useDesk.getState().load().catch(() => undefined);
  }, [ready]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
      useDesk.getState().setViewport(el.clientWidth, el.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [layout?.id]);

  const setGuides = useCallback((g: Guides) => setGuide(g), []);

  if (!layout) {
    return (
      <div className="grid h-full place-items-center">
        <Skeleton className="h-32 w-80 rounded-lg" />
      </div>
    );
  }

  const data = layout.data;
  const panelW = editing && box.w > 900 ? 330 : 0;
  const availW = Math.max(200, box.w - panelW);
  const narrow = box.w > 0 && box.w < 720;
  const scale = narrow ? 1 : Math.min(1.6, Math.max(0.45, Math.min(availW / data.canvas.w, box.h / data.canvas.h)));
  const left = Math.max(0, (availW - data.canvas.w * scale) / 2);
  const top = Math.max(0, (box.h - data.canvas.h * scale) / 2);
  const items = sortedByZ(data.items);

  const toCanvas = (clientX: number, clientY: number) => {
    const r = area.current!.getBoundingClientRect();
    return { x: (clientX - r.left - left) / scale, y: (clientY - r.top - top) / scale };
  };

  return (
    <div
      ref={area}
      className="relative h-full w-full overflow-hidden"
      onPointerDown={(e) => {
        if (editing && e.target === e.currentTarget) useDesk.getState().select(null);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/karasu-asset")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDropping(false);
        const at = toCanvas(e.clientX, e.clientY);
        const assetId = e.dataTransfer.getData("text/karasu-asset");
        if (assetId) {
          const ratio = Number(e.dataTransfer.getData("text/karasu-ratio")) || 1;
          const w = Math.round(ratio >= 1 ? 320 : 320 * ratio);
          const h = Math.round(ratio >= 1 ? 320 / ratio : 320);
          useDesk.getState().addItem({ kind: "image", x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, r: 0, style: {}, props: { asset: assetId, fit: "contain", ink: "ink" } });
          return;
        }
        await addImages(Array.from(e.dataTransfer.files), at);
      }}
    >
      {narrow ? (
        <div className="scroll-area h-full space-y-3 p-3">
          {items
            .filter((i) => !i.hidden && WIDGET[i.kind] && !WIDGET[i.kind].decor)
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((i) => (
              <div key={i.id} style={{ height: Math.min(420, Math.max(64, i.h)) }}>
                <ItemFrame item={i} def={WIDGET[i.kind]} look={look}>
                  {(() => {
                    const C = WIDGET[i.kind].Component;
                    return <C item={i} editing={false} />;
                  })()}
                </ItemFrame>
              </div>
            ))}
        </div>
      ) : (
        <div
          className="absolute origin-top-left"
          style={{ left, top, width: data.canvas.w, height: data.canvas.h, transform: `scale(${scale})` }}
          onPointerDown={(e) => {
            if (editing && e.target === e.currentTarget) useDesk.getState().select(null);
          }}
        >
          {editing && (
            <div
              className="pointer-events-none absolute inset-0 outline outline-1 outline-dashed outline-fg-0/20"
              style={{
                backgroundImage: "radial-gradient(color-mix(in srgb, var(--ink) 22%, transparent) 1px, transparent 1.2px)",
                backgroundSize: `${data.grid * 4}px ${data.grid * 4}px`,
              }}
            />
          )}
          {items.map((item) => (
            <DeskItem key={item.id} item={item} look={look} editing={editing} selected={selected === item.id} scale={scale} setGuides={setGuides} />
          ))}
          {guide?.x != null && <div className="pointer-events-none absolute inset-y-0 z-[999] w-px bg-fg-0/70" style={{ left: guide.x }} />}
          {guide?.y != null && <div className="pointer-events-none absolute inset-x-0 z-[999] h-px bg-fg-0/70" style={{ top: guide.y }} />}
        </div>
      )}

      <AnimatePresence>{editing && <Toolbar />}</AnimatePresence>
      <AnimatePresence>{editing && <Panels />}</AnimatePresence>
      <AnimatePresence>
        {dropping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-3 z-[70] grid place-items-center rounded-lg border-2 border-dashed border-fg-0/60 bg-paper/40 font-mono text-sm text-fg-0"
          >
            drop images to place them on the desk
          </motion.div>
        )}
      </AnimatePresence>
      {!editing && !narrow && (
        <button
          onClick={() => useDesk.getState().setEditing(true)}
          className="glass absolute bottom-3 right-3 z-30 flex h-9 items-center gap-2 rounded-pill px-3.5 font-mono text-[12px] text-fg-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <Pencil size={13} /> arrange
        </button>
      )}
      {editing && !layout.data.items.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center font-mono text-sm text-fg-2">
            <Eye className="mx-auto mb-2" size={18} />
            empty desk. add widgets and images from the panel
          </div>
        </div>
      )}
    </div>
  );
}
