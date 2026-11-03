import { useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  RotateCcw,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { FONTS, PRESETS, useLook, type Wallpaper } from "../theme/look";
import { dropOwnLook, giveOwnLook } from "../theme/deskLook";
import { WallpaperFramer } from "../components/shell/WallpaperFramer";
import { cn } from "../components/ui/cn";
import { AssetLibrary, useAssets } from "./AssetLibrary";
import { fitToCanvas, sortedByZ } from "./geometry";
import { WIDGET, WIDGETS, resolvedStyle, type Field, type WidgetDef } from "./registry";
import { useActiveLayout, useDesk } from "./store";
import type { DeskData, Item, ItemStyle } from "./types";

const input = "h-7 w-full rounded-sm bg-bg-3 px-2 text-[12px] text-fg-0 outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_var(--line-strong)]";

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-fg-3">{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-[86px] shrink-0 truncate text-fg-2">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </label>
  );
}

function Range({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--ink)]" />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-fg-2">{format ? format(value) : value}</span>
    </>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={input}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn("relative h-5 w-9 rounded-pill transition-colors", on ? "bg-fg-0" : "bg-bg-4")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-pill transition-all", on ? "left-[18px] bg-bg-0" : "left-0.5 bg-fg-2")} />
    </button>
  );
}

function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="number" value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value) || 0)} className={cn(input, "tabular-nums")} />;
}

function useSetter() {
  const last = useRef({ key: "", at: 0 });
  return (key: string, fn: (d: DeskData) => DeskData) => {
    const now = Date.now();
    const coalesce = last.current.key === key && now - last.current.at < 1200;
    last.current = { key, at: now };
    useDesk.getState().update(fn, !coalesce);
  };
}

function patchItem(id: string, patch: (i: Item) => Item) {
  return (d: DeskData) => ({ ...d, items: d.items.map((i) => (i.id === id ? patch(i) : i)) });
}

function FieldControl({ item, field }: { item: Item; field: Field }) {
  const set = useSetter();
  const value = item.props[field.key];
  const put = (v: unknown) => set(`${item.id}.p.${field.key}`, patchItem(item.id, (i) => ({ ...i, props: { ...i.props, [field.key]: v } })));
  if (field.type === "asset")
    return (
      <div>
        <div className="mb-1.5 text-fg-2">{field.label}</div>
        <AssetLibrary columns={4} selected={(value as string) ?? null} onPick={(a) => put(a.id)} allowDelete={false} videos />
      </div>
    );
  return (
    <Row label={field.label}>
      {field.type === "select" && <Select value={String(value ?? field.options[0].value)} options={field.options} onChange={put} />}
      {field.type === "toggle" && <Toggle on={!!value} onChange={put} />}
      {field.type === "number" && <Range value={Number(value ?? field.min)} min={field.min} max={field.max} step={field.step} onChange={put} />}
      {field.type === "text" && <input value={String(value ?? "")} onChange={(e) => put(e.target.value)} className={input} />}
      {field.type === "textarea" && (
        <textarea value={String(value ?? "")} onChange={(e) => put(e.target.value)} rows={3} className={cn(input, "h-auto resize-y py-1.5 font-sans")} />
      )}
    </Row>
  );
}

function ElementPanel({ item }: { item: Item }) {
  const def = WIDGET[item.kind];
  const look = useLook((s) => s.look);
  const d = useDesk.getState();
  const set = useSetter();
  if (!def) return null;
  const s = resolvedStyle(item, def);
  const style = (key: keyof ItemStyle, v: unknown) => set(`${item.id}.s.${key}`, patchItem(item.id, (i) => ({ ...i, style: { ...i.style, [key]: v } })));
  const geom = (patch: Partial<Item>) => set(`${item.id}.g.${Object.keys(patch).join()}`, patchItem(item.id, (i) => ({ ...i, ...patch })));
  const Icon = def.icon;
  const bg = s.bg ?? "inherit";
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="shrink-0 text-fg-1" />
        <input value={item.name ?? ""} placeholder={def.label} onChange={(e) => geom({ name: e.target.value })} className={input} />
      </div>
      <div className="mb-4 grid grid-cols-4 gap-1">
        {[
          { label: "Duplicate", icon: Copy, run: () => d.duplicateItem(item.id) },
          { label: item.hidden ? "Show" : "Hide", icon: item.hidden ? Eye : EyeOff, run: () => d.updateItem(item.id, { hidden: !item.hidden }) },
          { label: item.locked ? "Unlock" : "Lock", icon: item.locked ? Unlock : Lock, run: () => d.updateItem(item.id, { locked: !item.locked }) },
          { label: "Delete", icon: Trash2, run: () => d.removeItem(item.id) },
        ].map((a) => (
          <button key={a.label} onClick={a.run} className="flex flex-col items-center gap-1 rounded-sm py-1.5 text-[10.5px] text-fg-2 transition-colors hover:bg-fg-0/10 hover:text-fg-0">
            <a.icon size={14} />
            {a.label}
          </button>
        ))}
      </div>

      <Section title="Position">
        <div className="grid grid-cols-4 gap-1.5 text-[10.5px] text-fg-3">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              {k.toUpperCase()}
              <Num value={item[k]} onChange={(v) => geom({ [k]: k === "w" || k === "h" ? Math.max(def.min[k], v) : v })} />
            </label>
          ))}
        </div>
        {def.rotatable && (
          <Row label="Rotation">
            <Range value={item.r} min={-180} max={180} step={1} onChange={(v) => geom({ r: v })} format={(v) => `${v}°`} />
          </Row>
        )}
        <div className="grid grid-cols-4 gap-1">
          {[
            { label: "Back", icon: ArrowDownToLine, op: "back" as const },
            { label: "Down", icon: ChevronDown, op: "down" as const },
            { label: "Up", icon: ChevronUp, op: "up" as const },
            { label: "Front", icon: ArrowUpToLine, op: "front" as const },
          ].map((a) => (
            <button key={a.op} onClick={() => d.restack(item.id, a.op)} className="flex items-center justify-center gap-1 rounded-sm bg-bg-3 py-1 text-[10.5px] text-fg-1 hover:bg-bg-4">
              <a.icon size={12} /> {a.label}
            </button>
          ))}
        </div>
      </Section>

      {def.fields && def.fields.length > 0 && (
        <Section title="Options">
          {def.fields
            .filter((f) => !f.show || f.show(item.props))
            .map((f) => (
              <FieldControl key={f.key} item={item} field={f} />
            ))}
        </Section>
      )}

      <Section
        title="Look"
        action={
          <button onClick={() => d.updateItem(item.id, { style: {} })} className="flex items-center gap-1 text-[10.5px] text-fg-3 hover:text-fg-0">
            <RotateCcw size={11} /> reset
          </button>
        }
      >
        <Row label="Frame">
          <Select
            value={s.titlebar ?? "inherit"}
            onChange={(v) => style("titlebar", v)}
            options={[
              { value: "inherit", label: `Same as look (${look.titlebar})` },
              { value: "bar", label: "Title bar" },
              { value: "line", label: "Thin title" },
              { value: "none", label: "No title" },
            ]}
          />
        </Row>
        <Row label="Background">
          <Select
            value={bg}
            onChange={(v) => style("bg", v)}
            options={[
              { value: "inherit", label: "Same as look" },
              { value: "none", label: "None" },
              { value: "color", label: "Color" },
              { value: "image", label: "Image" },
            ]}
          />
        </Row>
        {bg === "color" && (
          <Row label="Color">
            <input type="color" value={s.bgColor ?? look.surface} onChange={(e) => style("bgColor", e.target.value)} className="h-7 w-12 cursor-pointer rounded-sm bg-transparent" />
          </Row>
        )}
        {bg === "image" && (
          <>
            <AssetLibrary columns={4} selected={s.bgImage ?? null} onPick={(a) => style("bgImage", a.id)} allowDelete={false} />
            <Row label="Fit">
              <Select value={s.bgFit ?? "cover"} onChange={(v) => style("bgFit", v)} options={[{ value: "cover", label: "Fill" }, { value: "contain", label: "Whole image" }]} />
            </Row>
            <Row label="Darken">
              <Range value={s.bgDim ?? 0.35} min={0} max={0.95} step={0.05} onChange={(v) => style("bgDim", v)} format={(v) => `${Math.round(v * 100)}%`} />
            </Row>
          </>
        )}
        {(bg === "inherit" || bg === "color") && (
          <Row label="Surface">
            <Range value={s.surface ?? look.surfaceAlpha} min={0} max={1} step={0.05} onChange={(v) => style("surface", v)} format={(v) => `${Math.round(v * 100)}%`} />
          </Row>
        )}
        {bg !== "none" && (
          <Row label="Blur">
            <Range value={s.blur ?? look.blur} min={0} max={48} step={1} onChange={(v) => style("blur", v)} format={(v) => `${v}px`} />
          </Row>
        )}
        <Row label="Opacity">
          <Range value={s.opacity ?? 1} min={0.05} max={1} step={0.05} onChange={(v) => style("opacity", v)} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Border">
          <Range value={s.border ?? look.border} min={0} max={8} step={0.5} onChange={(v) => style("border", v)} format={(v) => `${v}px`} />
        </Row>
        {(s.border ?? look.border) > 0 && (
          <Row label="Edge">
            <Select
              value={s.borderStyle ?? "solid"}
              onChange={(v) => style("borderStyle", v)}
              options={[
                { value: "solid", label: "Solid" },
                { value: "dashed", label: "Dashed" },
                { value: "dotted", label: "Dotted" },
                { value: "double", label: "Double" },
              ]}
            />
            <input type="color" value={s.borderColor?.startsWith("#") ? s.borderColor : look.ink} onChange={(e) => style("borderColor", e.target.value)} className="h-7 w-10 shrink-0 cursor-pointer rounded-sm bg-transparent" />
          </Row>
        )}
        <Row label="Corners">
          <Range value={Math.min(80, s.radius ?? look.radius)} min={0} max={80} step={1} onChange={(v) => style("radius", v)} format={(v) => (v >= 80 ? "pill" : `${v}px`)} />
        </Row>
        <Row label="Shadow">
          <Select
            value={s.shadow ?? "inherit"}
            onChange={(v) => style("shadow", v)}
            options={[
              { value: "inherit", label: `Same as look (${look.shadow})` },
              { value: "none", label: "None" },
              { value: "soft", label: "Soft" },
              { value: "hard", label: "Hard offset" },
              { value: "glow", label: "Ink glow" },
            ]}
          />
        </Row>
        <Row label="Font">
          <Select value={s.font ?? ""} onChange={(v) => style("font", v || undefined)} options={[{ value: "", label: "Same as look" }, ...FONTS.map((f) => ({ value: f.id, label: `${f.label} · ${f.note}` }))]} />
        </Row>
        <Row label="Text size">
          <Range value={s.scale ?? 1} min={0.6} max={2.4} step={0.05} onChange={(v) => style("scale", v)} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Text color">
          <input type="color" value={s.color ?? look.ink} onChange={(e) => style("color", e.target.value)} className="h-7 w-12 cursor-pointer rounded-sm bg-transparent" />
          {s.color && (
            <button onClick={() => style("color", undefined)} className="text-[10.5px] text-fg-3 hover:text-fg-0">
              reset
            </button>
          )}
        </Row>
        <Row label="Padding">
          <Range value={s.padding ?? 14} min={0} max={48} step={1} onChange={(v) => style("padding", v)} format={(v) => `${v}px`} />
        </Row>
      </Section>
    </div>
  );
}

function center(def: WidgetDef, data: DeskData, nudge: number) {
  return {
    x: Math.round((data.canvas.w - def.size.w) / 2 + nudge),
    y: Math.round((data.canvas.h - def.size.h) / 2 + nudge),
  };
}

function AddPanel() {
  const layout = useActiveLayout();
  const [count, setCount] = useState(0);
  if (!layout) return null;
  const add = (def: WidgetDef) => {
    const pos = center(def, layout.data, (count % 6) * 20);
    setCount(count + 1);
    useDesk.getState().addItem({ kind: def.kind, ...pos, w: def.size.w, h: def.size.h, r: 0, style: {}, props: { ...(def.props ?? {}) } });
  };
  const groups = ["Music", "Visuals", "Daily", "Info", "Decor"] as const;
  return (
    <div>
      {groups.map((g) => (
        <Section key={g} title={g}>
          <div className="grid grid-cols-2 gap-1.5">
            {WIDGETS.filter((w) => w.group === g).map((w) => (
              <button
                key={w.kind}
                onClick={() => add(w)}
                className="flex items-center gap-2 rounded-sm bg-bg-3/70 px-2.5 py-2 text-left text-[12px] text-fg-1 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-bg-4 hover:text-fg-0"
              >
                <w.icon size={14} className="shrink-0" />
                <span className="truncate">{w.label}</span>
              </button>
            ))}
          </div>
        </Section>
      ))}
      <Section title="Your images">
        <AssetLibrary
          videos
          onPick={(a) => {
            const ratio = a.w && a.h ? a.w / a.h : 1;
            const w = Math.round(ratio >= 1 ? 320 : 320 * ratio);
            const h = Math.round(ratio >= 1 ? 320 / ratio : 320);
            useDesk.getState().addItem({ kind: "image", x: Math.round((layout.data.canvas.w - w) / 2), y: Math.round((layout.data.canvas.h - h) / 2), w, h, r: 0, style: {}, props: { asset: a.id, fit: "contain", ink: a.video ? "original" : "ink" } });
          }}
        />
        <p className="text-[11px] leading-relaxed text-fg-3">Click to place, or drag a picture onto the desk.</p>
      </Section>
    </div>
  );
}

function LayerRow({ item, selected, assetName }: { item: Item; selected: boolean; assetName?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const def = WIDGET[item.kind];
  const d = useDesk.getState();
  const Icon = def?.icon;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-1.5 rounded-sm px-1 py-1", selected ? "bg-fg-0/12 text-fg-0" : "text-fg-1 hover:bg-fg-0/6", isDragging && "relative z-10 bg-bg-4")}
    >
      <button {...attributes} {...listeners} aria-label="Drag to reorder" className="cursor-grab px-0.5 text-fg-3 hover:text-fg-0">
        <GripVertical size={13} />
      </button>
      <button onClick={() => d.select(item.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {Icon && <Icon size={13} className="shrink-0" />}
        <span className={cn("truncate", item.hidden && "text-fg-3 line-through")}>{item.name || assetName?.replace(/\.[a-z0-9]+$/i, "") || def?.label || item.kind}</span>
      </button>
      <button aria-label={item.hidden ? "Show" : "Hide"} onClick={() => d.updateItem(item.id, { hidden: !item.hidden })} className="text-fg-3 hover:text-fg-0">
        {item.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button aria-label={item.locked ? "Unlock" : "Lock"} onClick={() => d.updateItem(item.id, { locked: !item.locked })} className={cn("hover:text-fg-0", item.locked ? "text-fg-0" : "text-fg-3")}>
        {item.locked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    </div>
  );
}

function LayersPanel() {
  const layout = useActiveLayout();
  const selected = useDesk((s) => s.selected);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const { data: assets = [] } = useAssets();
  if (!layout) return null;
  const names = new Map(assets.map((a) => [a.id, a.name]));
  const ordered = sortedByZ(layout.data.items).reverse();
  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = ordered.map((i) => i.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    const z = new Map(next.map((id, i) => [id, next.length - i]));
    useDesk.getState().update((d) => ({ ...d, items: d.items.map((i) => ({ ...i, z: z.get(i.id) ?? i.z })) }));
  };
  return (
    <Section title={`Layers · ${ordered.length}`}>
      <p className="-mt-1 text-[11px] text-fg-3">Top of the list sits in front. Drag to reorder.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={ordered.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {ordered.map((i) => (
              <LayerRow key={i.id} item={i} selected={selected === i.id} assetName={i.kind === "image" ? names.get(String(i.props.asset)) : undefined} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </Section>
  );
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function DeskPanel() {
  const d = useDesk();
  const layout = useActiveLayout();
  const look = useLook((s) => s.look);
  const saved = useLook((s) => s.saved);
  const setLookWallpaper = useLook((s) => s.setWallpaper);
  const navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  if (!layout) return null;
  const data = layout.data;
  const ownLook = !!data.look;
  const own = data.wallpaper != null;
  const wp: Wallpaper = data.wallpaper ?? look.wallpaper;
  const setWp = (patch: Partial<Wallpaper>) => {
    if (own) d.update((x) => ({ ...x, wallpaper: { ...(x.wallpaper ?? look.wallpaper), ...patch } }));
    else setLookWallpaper(patch);
  };
  return (
    <div>
      <Section title="Desks">
        {d.layouts.map((l) => (
          <div key={l.id} className={cn("flex items-center gap-1.5 rounded-sm px-2 py-1.5", l.id === d.activeId ? "bg-fg-0/12" : "hover:bg-fg-0/6")}>
            {renaming === l.id ? (
              <input
                autoFocus
                defaultValue={l.name}
                onBlur={(e) => {
                  d.renameLayout(l.id, e.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className={input}
              />
            ) : (
              <button onClick={() => d.setActive(l.id)} onDoubleClick={() => setRenaming(l.id)} className="min-w-0 flex-1 truncate text-left text-fg-0">
                {l.id === d.activeId ? "● " : "○ "}
                {l.name}
              </button>
            )}
            <button aria-label="Rename" onClick={() => setRenaming(l.id)} className="text-[10.5px] text-fg-3 hover:text-fg-0">
              rename
            </button>
            <button aria-label="Duplicate desk" onClick={() => d.createLayout(`${l.name} copy`, structuredClone(l.data))} className="text-fg-3 hover:text-fg-0">
              <Copy size={12} />
            </button>
            {d.layouts.length > 1 && (
              <button
                aria-label={armed === l.id ? "Click again to delete" : "Delete desk"}
                onClick={async () => {
                  if (armed !== l.id) {
                    setArmed(l.id);
                    window.setTimeout(() => setArmed(null), 3000);
                    return;
                  }
                  await d.deleteLayout(l.id);
                  setArmed(null);
                }}
                className={armed === l.id ? "text-bad" : "text-fg-3 hover:text-fg-0"}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => d.createLayout(`Desk ${d.layouts.length + 1}`, { canvas: data.canvas, grid: data.grid, wallpaper: null, items: [] })}
            className="rounded-sm bg-bg-3 py-1.5 text-[11px] text-fg-1 hover:bg-bg-4"
          >
            new blank
          </button>
          <button
            onClick={() => download(`${layout.name.toLowerCase().replace(/\s+/g, "-")}.karasu-desk.json`, JSON.stringify({ format: "karasu-desk", version: 1, name: layout.name, data }, null, 2))}
            className="flex items-center justify-center gap-1 rounded-sm bg-bg-3 py-1.5 text-[11px] text-fg-1 hover:bg-bg-4"
          >
            <Download size={11} /> export
          </button>
          <button onClick={() => file.current?.click()} className="flex items-center justify-center gap-1 rounded-sm bg-bg-3 py-1.5 text-[11px] text-fg-1 hover:bg-bg-4">
            <Upload size={11} /> import
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const parsed = JSON.parse(await f.text());
              const incoming: DeskData = parsed.data ?? parsed;
              if (!Array.isArray(incoming.items) || !incoming.canvas) throw new Error("This isn't a Karasu desk file");
              await d.createLayout(parsed.name ?? f.name.replace(/\..*$/, ""), incoming);
              toast("Desk imported");
            } catch (error) {
              toast("Couldn't import that desk", { description: (error as Error).message });
            }
          }}
        />
        <p className="text-[11px] text-fg-3">Double-click a name to rename it. Desks also show as squares in the top bar.</p>
      </Section>

      <Section title="Look">
        <Row label="This desk">
          <Toggle on={ownLook} onChange={(v) => (v ? giveOwnLook(layout.id) : dropOwnLook(layout.id))} />
          <span className="text-[11px] text-fg-3">{ownLook ? "own look" : "shared look"}</span>
        </Row>
        <div className="grid grid-cols-4 gap-1.5">
          {Object.entries(PRESETS).map(([id, p]) => (
            <button
              key={id}
              title={p.name}
              aria-label={`${p.name} look for this desk`}
              onClick={() => {
                giveOwnLook(layout.id);
                useLook.getState().usePreset(id);
              }}
              className={cn(
                "seal grid aspect-square place-items-center rounded-sm text-[20px]",
                ownLook && look.preset === id ? "outline outline-2 outline-offset-1 outline-fg-0" : "outline outline-1 outline-line-strong",
              )}
              style={{ background: p.look.paper, color: p.look.ink }}
            >
              {p.kanji}
            </button>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {saved.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  giveOwnLook(layout.id);
                  useLook.getState().useSaved(s.id);
                }}
                className="rounded-pill bg-bg-3 px-2 py-0.5 text-[11px] text-fg-1 hover:bg-bg-4 hover:text-fg-0"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => navigate("/settings")} className="text-left text-[11px] text-fg-2 hover:text-fg-0">
          all look settings →
        </button>
        <p className="text-[11px] leading-relaxed text-fg-3">
          {ownLook
            ? "Colors, fonts, wallpaper, effects, weather, cursor and buttons you change now only apply to this desk."
            : "Pick a look above to give this desk its own. Other desks keep theirs."}
        </p>
      </Section>

      <Section title="Wallpaper">
        {!ownLook && (
          <Row label="This desk">
            <Toggle on={own} onChange={(v) => d.update((x) => ({ ...x, wallpaper: v ? { ...look.wallpaper } : null }))} />
            <span className="text-[11px] text-fg-3">{own ? "own wallpaper" : "uses the look's"}</span>
          </Row>
        )}
        <AssetLibrary columns={4} selected={wp.asset} onPick={(a) => setWp({ asset: a.id })} allowDelete={false} videos />
        {wp.asset && (
          <button onClick={() => setWp({ asset: null })} className="text-[11px] text-fg-3 hover:text-fg-0">
            remove wallpaper
          </button>
        )}
        {wp.asset && <WallpaperFramer wp={wp} onChange={setWp} />}
        <Row label="Fit">
          <Select value={wp.fit} onChange={(v) => setWp({ fit: v })} options={[{ value: "cover", label: "Fill" }, { value: "contain", label: "Whole image" }, { value: "tile", label: "Tile" }]} />
        </Row>
        <Row label="Position">
          <Select
            value={wp.position}
            onChange={(v) => setWp({ position: v, x: undefined, y: undefined })}
            options={["center", "top", "bottom", "left", "right"].map((p) => ({ value: p, label: p }))}
          />
        </Row>
        <Row label="Darken">
          <Range value={wp.dim} min={0} max={0.95} step={0.05} onChange={(v) => setWp({ dim: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="Blur">
          <Range value={wp.blur} min={0} max={40} step={1} onChange={(v) => setWp({ blur: v })} format={(v) => `${v}px`} />
        </Row>
        <Row label="Black & white">
          <Toggle on={wp.mono} onChange={(v) => setWp({ mono: v })} />
        </Row>
      </Section>

      <Section title="Canvas">
        <div className="grid grid-cols-2 gap-1.5 text-[10.5px] text-fg-3">
          <label className="flex flex-col gap-0.5">
            WIDTH
            <Num value={data.canvas.w} onChange={(v) => d.update((x) => ({ ...x, canvas: { ...x.canvas, w: Math.max(400, v) } }))} />
          </label>
          <label className="flex flex-col gap-0.5">
            HEIGHT
            <Num value={data.canvas.h} onChange={(v) => d.update((x) => ({ ...x, canvas: { ...x.canvas, h: Math.max(300, v) } }))} />
          </label>
        </div>
        <button
          onClick={() => {
            const vw = d.viewport.w - (d.viewport.w > 900 ? 330 : 0) - 24;
            const vh = d.viewport.h - 24;
            if (vw < 300 || vh < 200) return;
            d.update((x) => ({ ...x, canvas: { w: vw, h: vh }, items: fitToCanvas(x.items, x.canvas, { w: vw, h: vh }) }));
          }}
          className="w-full rounded-sm bg-bg-3 py-1.5 text-[11px] text-fg-1 hover:bg-bg-4"
        >
          fit the desk to this window
        </button>
        <Row label="Grid">
          <Select
            value={String(data.grid)}
            onChange={(v) => d.update((x) => ({ ...x, grid: Number(v) }))}
            options={[1, 4, 8, 12, 16, 24, 32].map((g) => ({ value: String(g), label: g === 1 ? "off" : `${g}px` }))}
          />
        </Row>
      </Section>
    </div>
  );
}

export function Panels() {
  const panel = useDesk((s) => s.panel);
  const selected = useDesk((s) => s.selected);
  const layout = useActiveLayout();
  const item = layout?.data.items.find((i) => i.id === selected);
  const tabs = [
    { id: "add", label: "add" },
    { id: "element", label: "element", disabled: !item },
    { id: "layers", label: "layers" },
    { id: "desk", label: "desk" },
  ] as const;
  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className="glass absolute bottom-3 right-3 top-3 z-[60] flex w-[316px] flex-col overflow-hidden rounded-lg font-mono text-[12.5px]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            disabled={"disabled" in t && t.disabled}
            onClick={() => useDesk.getState().setPanel(t.id)}
            className={cn(
              "flex-1 py-2.5 text-[11.5px] lowercase tracking-wide transition-colors disabled:opacity-30",
              panel === t.id ? "bg-fg-0/10 text-fg-0 shadow-[inset_0_-2px_0_var(--ink)]" : "text-fg-2 hover:text-fg-0",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="scroll-area min-h-0 flex-1 p-3">
        {panel === "add" && <AddPanel />}
        {panel === "element" && item && <ElementPanel item={item} />}
        {panel === "element" && !item && <p className="text-fg-3">Click something on the desk to edit it.</p>}
        {panel === "layers" && <LayersPanel />}
        {panel === "desk" && <DeskPanel />}
      </div>
    </motion.aside>
  );
}
