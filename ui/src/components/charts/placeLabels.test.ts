import { describe, expect, it } from "vitest";
import { placeLabels, type Box } from "./TasteMap";

const overlaps = (a: Box, b: Box) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

describe("placeLabels", () => {
  it("pulls stacked labels apart and keeps them inside the map", () => {
    const boxes: Box[] = Array.from({ length: 6 }, (_, i) => ({ x: 500 + i * 3, y: 280 + i * 2, w: 120, h: 28, label: `L${i}`, i }));
    const placed = placeLabels(boxes, 1000, 560);
    for (let a = 0; a < placed.length; a++) {
      const box = placed[a];
      expect(box.x - box.w / 2).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w / 2).toBeLessThanOrEqual(1000);
      expect(box.y - box.h / 2).toBeGreaterThanOrEqual(0);
      expect(box.y + box.h / 2).toBeLessThanOrEqual(560);
      for (let b = a + 1; b < placed.length; b++) expect(overlaps(box, placed[b])).toBe(false);
    }
  });

  it("leaves separated labels where they are", () => {
    const boxes: Box[] = [
      { x: 200, y: 100, w: 100, h: 28, label: "A", i: 0 },
      { x: 700, y: 400, w: 100, h: 28, label: "B", i: 1 },
    ];
    expect(placeLabels(boxes, 1000, 560).map((b) => [b.x, b.y])).toEqual([[200, 100], [700, 400]]);
  });
});
