import { describe, expect, it } from "vitest";
import { nextPlayableIndex, shuffled } from "./queue";

describe("shuffled", () => {
  it("keeps the current track first and every index once", () => {
    const order = shuffled(10, 4);
    expect(order[0]).toBe(4);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("nextPlayableIndex", () => {
  const queue = [{ ok: true }, { ok: false }, { ok: true }, { ok: false }];
  const order = [0, 1, 2, 3];
  const ok = (t: { ok: boolean }) => t.ok;

  it("skips tracks that can't play", () => {
    expect(nextPlayableIndex(queue, order, 0, 1, false, ok)).toBe(2);
  });

  it("stops at the end unless repeat wraps", () => {
    expect(nextPlayableIndex(queue, order, 2, 1, false, ok)).toBe(-1);
    expect(nextPlayableIndex(queue, order, 2, 1, true, ok)).toBe(0);
  });

  it("walks backwards for previous", () => {
    expect(nextPlayableIndex(queue, order, 2, -1, false, ok)).toBe(0);
    expect(nextPlayableIndex(queue, order, 0, -1, false, ok)).toBe(-1);
  });

  it("follows the shuffled order", () => {
    expect(nextPlayableIndex(queue, [2, 3, 0, 1], 2, 1, false, ok)).toBe(0);
  });
});
