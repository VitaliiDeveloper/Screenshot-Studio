import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import { projectScreenGroup, sameScreenGroup } from "./connected-canvas.js";

function project(): Project {
  return {
    meta: { name: "Connected", schemaVersion: 2 },
    mode: "connected",
    platforms: ["apple", "android"],
    locales: ["en", "fr"],
    fonts: [],
    screens: [
      screen("first", "apple", "en", 100),
      screen("french", "apple", "fr", 80),
      screen("second", "apple", "en", 120),
      screen("android", "android", "en", 90),
      screen("third", "apple", "en", 140),
    ],
  };
}

function screen(
  id: string,
  platform: "apple" | "android",
  locale: string,
  width: number,
): Project["screens"][number] {
  const common = {
    id,
    name: id,
    locale,
    direction: "ltr" as const,
    artboard: { width, height: 200 },
    background: { type: "solid" as const, color: "#000000" },
    elements: [],
  };
  return platform === "apple"
    ? { ...common, platform: "apple", device: "iphone" }
    : { ...common, platform: "android", device: "phone" };
}

describe("connected canvas projection", () => {
  it("matches exact platform, device, and locale", () => {
    const [first, french, , android] = project().screens;
    expect(sameScreenGroup(first!, french!)).toBe(false);
    expect(sameScreenGroup(first!, android!)).toBe(false);
    expect(sameScreenGroup(first!, project().screens[2]!)).toBe(true);
  });

  it("projects an interleaved group in project order with cumulative variable widths", () => {
    const projected = projectScreenGroup(project(), "second");
    expect(projected.map(({ screen, x, y }) => ({ id: screen.id, x, y }))).toEqual([
      { id: "first", x: 0, y: 0 },
      { id: "second", x: 100, y: 0 },
      { id: "third", x: 220, y: 0 },
    ]);
  });

  it("rejects an unknown target screen", () => {
    expect(() => projectScreenGroup(project(), "missing")).toThrow(/not found/);
  });
});
