import type { Handle, Item, Rect } from "./types";

export const snap = (value: number, grid: number, on = true) => (on && grid > 1 ? Math.round(value / grid) * grid : Math.round(value));

const rad = (deg: number) => (deg * Math.PI) / 180;

function rotate(x: number, y: number, deg: number) {
  const a = rad(deg);
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

const SIGN: Record<Handle, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
};

export function moveRect(start: Rect, dx: number, dy: number, grid: number, snapOn: boolean): Rect {
  return { ...start, x: snap(start.x + dx, grid, snapOn), y: snap(start.y + dy, grid, snapOn) };
}

export function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  opts: { min: { w: number; h: number }; keepRatio?: boolean; grid?: number; snap?: boolean },
): Rect {
  const [sx, sy] = SIGN[handle];
  const local = rotate(dx, dy, -start.r);
  let w = start.w + sx * local.x;
  let h = start.h + sy * local.y;
  if (opts.keepRatio && sx !== 0 && sy !== 0) {
    const f = Math.max(w / start.w, h / start.h);
    w = start.w * f;
    h = start.h * f;
  }
  if (opts.snap && opts.grid && start.r % 360 === 0) {
    if (sx !== 0) w = snap(w, opts.grid);
    if (sy !== 0) h = snap(h, opts.grid);
  }
  w = Math.max(opts.min.w, Math.round(sx === 0 ? start.w : w));
  h = Math.max(opts.min.h, Math.round(sy === 0 ? start.h : h));
  const shift = rotate((sx * (w - start.w)) / 2, (sy * (h - start.h)) / 2, start.r);
  const cx = start.x + start.w / 2 + shift.x;
  const cy = start.y + start.h / 2 + shift.y;
  return { ...start, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
}

export function angleFrom(center: { x: number; y: number }, point: { x: number; y: number }, step?: number) {
  let deg = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  if (deg > 180) deg -= 360;
  if (step) deg = Math.round(deg / step) * step;
  return Math.round(deg * 10) / 10;
}

export function keepVisible(rect: Rect, canvas: { w: number; h: number }, margin = 32): Rect {
  return {
    ...rect,
    x: Math.min(canvas.w - margin, Math.max(margin - rect.w, rect.x)),
    y: Math.min(canvas.h - margin, Math.max(0, rect.y)),
  };
}

export function sortedByZ(items: Item[]) {
  return [...items].sort((a, b) => a.z - b.z);
}

export function restack(items: Item[], id: string, op: "front" | "back" | "up" | "down"): Item[] {
  const order = sortedByZ(items).map((i) => i.id);
  const at = order.indexOf(id);
  if (at < 0) return items;
  order.splice(at, 1);
  const target = op === "front" ? order.length : op === "back" ? 0 : op === "up" ? Math.min(order.length, at + 1) : Math.max(0, at - 1);
  order.splice(target, 0, id);
  const z = new Map(order.map((key, i) => [key, i + 1]));
  return items.map((i) => ({ ...i, z: z.get(i.id) ?? i.z }));
}

export function topZ(items: Item[]) {
  return items.reduce((m, i) => Math.max(m, i.z), 0) + 1;
}

export function guides(moving: Rect, others: Rect[], canvas: { w: number; h: number }, threshold = 6) {
  const xs = [0, canvas.w / 2, canvas.w];
  const ys = [0, canvas.h / 2, canvas.h];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const edgesX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const edgesY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
  let bestX: { delta: number; line: number } | null = null;
  let bestY: { delta: number; line: number } | null = null;
  for (const line of xs)
    for (const edge of edgesX) {
      const delta = line - edge;
      if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, line };
    }
  for (const line of ys)
    for (const edge of edgesY) {
      const delta = line - edge;
      if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, line };
    }
  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, x: bestX?.line ?? null, y: bestY?.line ?? null };
}

export function fitToCanvas(items: Item[], from: { w: number; h: number }, to: { w: number; h: number }): Item[] {
  const fx = to.w / from.w;
  const fy = to.h / from.h;
  return items.map((i) => ({ ...i, x: Math.round(i.x * fx), y: Math.round(i.y * fy), w: Math.round(i.w * fx), h: Math.round(i.h * fy) }));
}
