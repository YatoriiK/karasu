import { describe, expect, it } from "vitest";
import { angleFrom, fitToCanvas, guides, moveRect, resizeRect, restack, snap } from "./geometry";
import type { Item } from "./types";

const item = (id: string, z: number): Item => ({ id, kind: "clock", x: 0, y: 0, w: 10, h: 10, r: 0, z, style: {}, props: {} });

describe("snap and move", () => {
  it("snaps to the grid only when asked", () => {
    expect(snap(13, 8)).toBe(16);
    expect(snap(13, 8, false)).toBe(13);
    expect(moveRect({ x: 10, y: 10, w: 50, h: 50, r: 0 }, 5, 7, 8, true)).toMatchObject({ x: 16, y: 16 });
  });
});

describe("resizeRect", () => {
  const base = { x: 100, y: 100, w: 200, h: 100, r: 0 };
  const min = { w: 40, h: 40 };

  it("grows from the bottom-right corner and keeps the top-left fixed", () => {
    expect(resizeRect(base, "se", 50, 20, { min })).toEqual({ x: 100, y: 100, w: 250, h: 120, r: 0 });
  });

  it("grows from the top-left corner and moves the origin", () => {
    expect(resizeRect(base, "nw", -30, -10, { min })).toEqual({ x: 70, y: 90, w: 230, h: 110, r: 0 });
  });

  it("respects the minimum size", () => {
    expect(resizeRect(base, "e", -500, 0, { min })).toMatchObject({ w: 40, x: 100 });
  });

  it("keeps the aspect ratio with shift", () => {
    const r = resizeRect(base, "se", 100, 0, { min, keepRatio: true });
    expect(r.w / r.h).toBeCloseTo(2, 1);
  });

  it("resizes along the rotated axis and keeps the opposite edge in place", () => {
    const rotated = { x: 0, y: 0, w: 100, h: 50, r: 90 };
    const r = resizeRect(rotated, "e", 0, 40, { min });
    expect(r.w).toBe(140);
    expect(r.h).toBe(50);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    expect(Math.round(cx)).toBe(50);
    expect(Math.round(cy)).toBe(45);
  });
});

describe("angleFrom", () => {
  it("reads 0° straight up and 90° to the right, with optional steps", () => {
    expect(angleFrom({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0);
    expect(angleFrom({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
    expect(angleFrom({ x: 0, y: 0 }, { x: 10, y: -9 }, 15)).toBe(45);
  });
});

describe("restack", () => {
  it("moves layers and renumbers z", () => {
    const items = [item("a", 1), item("b", 2), item("c", 3)];
    const front = restack(items, "a", "front");
    expect(front.find((i) => i.id === "a")?.z).toBe(3);
    const back = restack(items, "c", "back");
    expect(back.find((i) => i.id === "c")?.z).toBe(1);
    const up = restack(items, "a", "up");
    expect(up.find((i) => i.id === "a")?.z).toBe(2);
  });
});

describe("guides", () => {
  it("snaps an edge onto a nearby element and the canvas center", () => {
    const g = guides({ x: 103, y: 50, w: 40, h: 40, r: 0 }, [{ x: 100, y: 300, w: 80, h: 20, r: 0 }], { w: 1000, h: 600 });
    expect(g.dx).toBe(-3);
    expect(g.x).toBe(100);
    const c = guides({ x: 478, y: 0, w: 40, h: 40, r: 0 }, [], { w: 1000, h: 600 });
    expect(c.x).toBe(500);
  });
});

describe("fitToCanvas", () => {
  it("scales positions and sizes to a new canvas", () => {
    const [i] = fitToCanvas([{ ...item("a", 1), x: 100, y: 50, w: 200, h: 100 }], { w: 1000, h: 500 }, { w: 500, h: 1000 });
    expect(i).toMatchObject({ x: 50, y: 100, w: 100, h: 200 });
  });
});
