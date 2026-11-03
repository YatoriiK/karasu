import { describe, expect, it } from "vitest";
import { Pulse } from "./pulse";

function run(seconds: number, frame: (t: number, bands: Float32Array) => number, fps = 60) {
  const pulse = new Pulse();
  const bands = new Float32Array(64);
  const hits: number[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const rms = frame(t, bands);
    pulse.update(bands, rms, 1 / fps);
    if (pulse.hit) hits.push(t);
  }
  return { pulse, hits };
}

const kick = (t: number, bands: Float32Array, period = 0.5) => {
  const phase = t % period;
  const punch = phase < 0.05 ? 1 : Math.max(0, 1 - (phase - 0.05) * 6);
  for (let b = 0; b < 64; b++) bands[b] = b < 10 ? 0.35 + 0.55 * punch : 0.4 + 0.05 * Math.sin(t * 7 + b);
  return 0.4;
};

describe("Pulse", () => {
  it("finds a steady kick drum", () => {
    const { hits } = run(6, (t, bands) => kick(t, bands));
    const late = hits.filter((t) => t > 1);
    expect(late.length).toBeGreaterThanOrEqual(9);
    expect(late.length).toBeLessThanOrEqual(11);
    for (const t of late) expect(Math.min(t % 0.5, 0.5 - (t % 0.5))).toBeLessThan(0.06);
  });

  it("keeps the same beats when levels arrive slower than the screen refreshes", () => {
    let held = new Float32Array(64);
    const { hits } = run(6, (t, bands) => {
      if (Math.floor(t * 40) !== Math.floor((t - 1 / 60) * 40)) {
        kick(t, bands);
        held = Float32Array.from(bands);
      } else bands.set(held);
      return 0.4;
    });
    expect(hits.filter((t) => t > 1).length).toBeGreaterThanOrEqual(9);
    expect(hits.filter((t) => t > 1).length).toBeLessThanOrEqual(11);
  });

  it("stays quiet in silence and on steady noise", () => {
    expect(run(4, (_, bands) => (bands.fill(0), 0)).hits).toHaveLength(0);
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.04;
    const { hits, pulse } = run(6, (_, bands) => {
      for (let b = 0; b < 64; b++) bands[b] = 0.5 + noise();
      return 0.3;
    });
    expect(hits.filter((t) => t > 1).length).toBeLessThanOrEqual(3);
    expect(pulse.energy).toBeGreaterThan(0.25);
  });
});
