import { describe, expect, it } from "vitest";
import { completeLook, FX, type Look } from "./look";
import { codeToLook, lookToCode, mergeShared } from "./shareCode";

const mine = (): Look => ({
  ...completeLook({}),
  ink: "#e8e2d0",
  accent: "#ff3366",
  wallpaper: { ...completeLook({}).wallpaper, asset: "my-photo", dim: 0.4, zoom: 1.6, x: 0.2 },
  fx: { ...FX, particles: "rain", density: 1.8, cursor: "image", cursorAsset: "my-cursor", cursorTrail: "comet", css: ".x{color:red}" },
  skins: { play: { asset: "my-button", mode: "ink" } },
});

describe("look codes", () => {
  it("round-trips the settings but leaves the pictures out", async () => {
    const code = await lookToCode(mine());
    expect(code.startsWith("KARASU-")).toBe(true);
    expect(code.length).toBeLessThan(400);
    expect(code).not.toContain("my-photo");
    const shared = await codeToLook(`  ${code}\n`);
    const fx = { ...FX, ...shared.look.fx };
    expect(shared.look.ink).toBe("#e8e2d0");
    expect(shared.look.accent).toBe("#ff3366");
    expect(shared.look.wallpaper.dim).toBe(0.4);
    expect(shared.look.wallpaper.asset).toBe(completeLook({}).wallpaper.asset);
    expect(fx.particles).toBe("rain");
    expect(fx.density).toBe(1.8);
    expect(fx.cursorAsset).toBeNull();
    expect(fx.css).toBe("");
    expect(shared.css).toBe(".x{color:red}");
    expect(shared.summary).toContain("Rain");
    expect(shared.summary).toContain("custom CSS");
  });

  it("keeps your own pictures and CSS when you use someone else's code", async () => {
    const shared = await codeToLook(await lookToCode(mine()));
    const friend: Look = {
      ...completeLook({}),
      wallpaper: { ...completeLook({}).wallpaper, asset: "friend-photo", zoom: 1.1 },
      fx: { ...FX, cursorAsset: "friend-cursor", css: ".mine{}" },
      skins: { next: { asset: "friend-button", mode: "light" } },
    };
    const merged = mergeShared(friend, shared, false);
    const fx = { ...FX, ...merged.fx };
    expect(merged.ink).toBe("#e8e2d0");
    expect(merged.wallpaper.asset).toBe("friend-photo");
    expect(merged.wallpaper.zoom).toBe(1.1);
    expect(merged.wallpaper.dim).toBe(0.4);
    expect(fx.cursorAsset).toBe("friend-cursor");
    expect(fx.cursor).toBe("image");
    expect(fx.css).toBe(".mine{}");
    expect(merged.skins).toEqual(friend.skins);
    expect({ ...FX, ...mergeShared(friend, shared, true).fx }.css).toBe(".x{color:red}");
    const noCursor = mergeShared({ ...friend, fx: { ...FX } }, shared, false);
    expect({ ...FX, ...noCursor.fx }.cursor).toBe("default");
  });

  it("ignores junk and refuses broken codes", async () => {
    const sneaky = { v: 1, l: { ink: 42, scheme: "purple", radius: 9, nope: true, fx: { particles: "lava", speed: "fast", cursorAsset: "x" } } };
    const bytes = new TextEncoder().encode(JSON.stringify(sneaky));
    const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const code = "KARASU-" + btoa(String.fromCharCode(...packed)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const shared = await codeToLook(code);
    const start = completeLook({});
    expect(shared.look.ink).toBe(start.ink);
    expect(shared.look.scheme).toBe(start.scheme);
    expect(shared.look.radius).toBe(9);
    expect("nope" in shared.look).toBe(false);
    expect({ ...FX, ...shared.look.fx }.particles).toBe("none");
    expect({ ...FX, ...shared.look.fx }.speed).toBe(FX.speed);
    await expect(codeToLook("hello")).rejects.toThrow("KARASU-");
    await expect(codeToLook("KARASU-!!!!")).rejects.toThrow("broken");
  });
});
