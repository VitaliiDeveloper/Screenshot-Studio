import { describe, expect, it } from "vitest";
import type { Screen } from "../model/index.js";
import { parseStoreSpecs } from "./specs.js";
import { artboardTargetStatus, artboardTargetStatuses } from "./artboard-status.js";

const specs = parseStoreSpecs({
  apple: {
    iphone: [
      { id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" },
      { id: "6.1", label: "6.1", width: 1100, height: 2390, orientation: "portrait" },
    ],
  },
  android: { phone: [{ id: "phone-portrait", label: "P", width: 1080, height: 1920, orientation: "portrait" }] },
});

describe("artboardTargetStatus", () => {
  it("reports exact when dimensions equal the target", () => {
    expect(artboardTargetStatus({ width: 1320, height: 2868 }, { width: 1320, height: 2868 })).toEqual({
      kind: "exact",
      pixelRatio: 1,
    });
  });

  it("reports proportional when the aspect ratio matches but dimensions differ", () => {
    expect(artboardTargetStatus({ width: 660, height: 1434 }, { width: 1320, height: 2868 })).toEqual({
      kind: "proportional",
      pixelRatio: 2,
    });
  });

  it("reports invalid with a message when the aspect ratio does not match", () => {
    const status = artboardTargetStatus({ width: 1320, height: 2000 }, { width: 1320, height: 2868 });
    expect(status.kind).toBe("invalid");
    if (status.kind === "invalid") expect(status.message).toMatch(/aspect ratio/);
  });
});

describe("artboardTargetStatuses", () => {
  it("returns one status per store size under the screen's platform/device", () => {
    const screen = { platform: "apple", device: "iphone", artboard: { width: 1320, height: 2868 } } as Screen;
    const results = artboardTargetStatuses(screen, specs);
    expect(results.map((r) => [r.target.id, r.status.kind])).toEqual([
      ["6.9", "exact"],
      ["6.1", "proportional"],
    ]);
  });

  it("returns an empty list for an unsupported platform/device", () => {
    const screen = { platform: "apple", device: "ipad", artboard: { width: 100, height: 100 } } as Screen;
    expect(artboardTargetStatuses(screen, specs)).toEqual([]);
  });
});
