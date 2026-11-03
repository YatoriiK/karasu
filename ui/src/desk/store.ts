import { create } from "zustand";
import { toast } from "sonner";
import { api } from "../lib/api";
import { usePrefs } from "../store/prefs";
import type { Look } from "../theme/look";
import { restack, topZ } from "./geometry";
import type { DeskData, Item, ItemStyle, Layout } from "./types";

type Saving = "idle" | "saving" | "saved" | "error";

type DeskState = {
  ready: boolean;
  layouts: Layout[];
  activeId: number | null;
  editing: boolean;
  selected: string | null;
  past: DeskData[];
  future: DeskData[];
  saving: Saving;
  panel: "element" | "add" | "layers" | "desk";
  viewport: { w: number; h: number };
  setViewport: (w: number, h: number) => void;
  load: () => Promise<void>;
  setActive: (id: number) => void;
  setEditing: (on: boolean) => void;
  select: (id: string | null) => void;
  setPanel: (panel: DeskState["panel"]) => void;
  checkpoint: () => void;
  update: (fn: (d: DeskData) => DeskData, history?: boolean) => void;
  updateItem: (id: string, patch: Partial<Item>, history?: boolean) => void;
  updateStyle: (id: string, patch: Partial<ItemStyle>) => void;
  updateProps: (id: string, patch: Record<string, unknown>) => void;
  addItem: (item: Omit<Item, "id" | "z">) => string;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  restack: (id: string, op: "front" | "back" | "up" | "down") => void;
  undo: () => void;
  redo: () => void;
  createLayout: (name: string, data?: DeskData) => Promise<void>;
  renameLayout: (id: number, name: string) => void;
  deleteLayout: (id: number) => Promise<void>;
  setDeskLook: (id: number, look: Look | null, wallpaper?: null) => void;
};

const timers = new Map<number, number>();

function crossfade(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> } };
  if (!doc.startViewTransition || usePrefs.getState().motion === "off") return change();
  const t = doc.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        change();
        window.setTimeout(resolve, 90);
      }),
  );
  for (const p of [t.finished, t.ready, t.updateCallbackDone]) p.catch(() => undefined);
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export const useDesk = create<DeskState>((set, get) => {
  const active = () => get().layouts.find((l) => l.id === get().activeId);

  const persist = (layout: Layout) => {
    window.clearTimeout(timers.get(layout.id));
    set({ saving: "saving" });
    timers.set(
      layout.id,
      window.setTimeout(async () => {
        const latest = get().layouts.find((l) => l.id === layout.id);
        if (!latest) return;
        try {
          await api.saveLayout(latest.id, { name: latest.name, data: latest.data });
          set({ saving: "saved" });
        } catch (error) {
          set({ saving: "error" });
          toast("Couldn't save your desk", { description: (error as Error).message });
        }
      }, 500),
    );
  };

  const write = (data: DeskData) => {
    const layout = active();
    if (!layout) return;
    const next = { ...layout, data };
    set({ layouts: get().layouts.map((l) => (l.id === layout.id ? next : l)) });
    persist(next);
  };

  return {
    ready: false,
    layouts: [],
    activeId: null,
    editing: false,
    selected: null,
    past: [],
    future: [],
    saving: "idle",
    panel: "add",
    viewport: { w: 0, h: 0 },
    setViewport: (w, h) => {
      const v = get().viewport;
      if (v.w !== w || v.h !== h) set({ viewport: { w, h } });
    },

    load: async () => {
      const res = await api.layouts();
      set({ layouts: res.layouts, activeId: res.active, ready: true });
    },

    setActive: (id) => {
      if (id === get().activeId) return;
      const target = get().layouts.find((l) => l.id === id);
      const change = () => set({ activeId: id, selected: null, past: [], future: [] });
      if (active()?.data.look || target?.data.look) crossfade(change);
      else change();
      void api.activateLayout(id).catch(() => undefined);
    },

    setEditing: (on) => set({ editing: on, selected: on ? get().selected : null, panel: on ? get().panel : "add" }),
    select: (id) => set({ selected: id, panel: id ? "element" : get().panel === "element" ? "add" : get().panel }),
    setPanel: (panel) => set({ panel }),

    checkpoint: () => {
      const layout = active();
      if (!layout) return;
      set({ past: [...get().past.slice(-59), layout.data], future: [] });
    },

    update: (fn, history = true) => {
      const layout = active();
      if (!layout) return;
      if (history) get().checkpoint();
      write(fn(layout.data));
    },

    updateItem: (id, patch, history = true) =>
      get().update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }), history),

    updateStyle: (id, patch) =>
      get().update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, style: { ...i.style, ...patch } } : i)) })),

    updateProps: (id, patch) =>
      get().update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, props: { ...i.props, ...patch } } : i)) })),

    addItem: (item) => {
      const id = newId();
      get().update((d) => ({ ...d, items: [...d.items, { ...item, id, z: topZ(d.items) }] }));
      set({ selected: id, panel: "element" });
      return id;
    },

    removeItem: (id) => {
      get().update((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
      if (get().selected === id) set({ selected: null, panel: "add" });
    },

    duplicateItem: (id) => {
      const layout = active();
      const source = layout?.data.items.find((i) => i.id === id);
      if (!source) return;
      const copy = { ...structuredClone(source), x: source.x + 24, y: source.y + 24 };
      const { id: _old, z: _z, ...rest } = copy;
      void _old;
      void _z;
      get().addItem(rest);
    },

    restack: (id, op) => get().update((d) => ({ ...d, items: restack(d.items, id, op) })),

    undo: () => {
      const layout = active();
      const past = get().past;
      if (!layout || !past.length) return;
      const previous = past[past.length - 1];
      set({ past: past.slice(0, -1), future: [layout.data, ...get().future].slice(0, 60) });
      write({ ...previous, look: layout.data.look });
    },

    redo: () => {
      const layout = active();
      const [next, ...rest] = get().future;
      if (!layout || !next) return;
      set({ future: rest, past: [...get().past, layout.data] });
      write({ ...next, look: layout.data.look });
    },

    createLayout: async (name, data) => {
      const layout = await api.createLayout(name, data);
      set({ layouts: [...get().layouts, layout], activeId: layout.id, selected: null, past: [], future: [] });
    },

    renameLayout: (id, name) => {
      const layout = get().layouts.find((l) => l.id === id);
      if (!layout) return;
      const next = { ...layout, name: name.trim().slice(0, 40) || layout.name };
      set({ layouts: get().layouts.map((l) => (l.id === id ? next : l)) });
      persist(next);
    },

    deleteLayout: async (id) => {
      await api.deleteLayout(id);
      const layouts = get().layouts.filter((l) => l.id !== id);
      const activeId = get().activeId === id ? (layouts[0]?.id ?? null) : get().activeId;
      set({ layouts, activeId, selected: null, past: [], future: [] });
      if (activeId) void api.activateLayout(activeId).catch(() => undefined);
    },

    setDeskLook: (id, look, wallpaper) => {
      const layout = get().layouts.find((l) => l.id === id);
      if (!layout) return;
      const data: DeskData = { ...layout.data, look };
      if (!look) delete data.look;
      if (wallpaper === null) data.wallpaper = null;
      const next = { ...layout, data };
      set({ layouts: get().layouts.map((l) => (l.id === id ? next : l)) });
      persist(next);
    },
  };
});

export function useActiveLayout() {
  return useDesk((s) => s.layouts.find((l) => l.id === s.activeId));
}
