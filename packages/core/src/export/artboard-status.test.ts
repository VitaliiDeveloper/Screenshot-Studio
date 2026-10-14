// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Screen } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS } from "./specs.js";
import { artboardTargetStatus, artboardTargetStatuses } from "./artboard-status.js";

const specs = structuredClone(DEFAULT_STORE_SPECS);
specs.platforms.apple.families.iphone.targets = [
  { id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" },
  { id: "6.1", label: "6.1", width: 1100, height: 2390, orientation: "portrait" },
];
specs.platforms.apple.families.ipad.targets = [];
specs.platforms.android.families.phone.targets = specs.platforms.android.families.phone.targets
  .filter(({ id }) => id === "phone-portrait" || id === "play-feature-graphic");

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

  it("includes non-device output targets owned by the screen family", () => {
    const screen = {
      platform: "android", device: "phone", artboard: { width: 1024, height: 500 },
    } as Screen;
    expect(artboardTargetStatuses(screen, specs).map(({ target, status }) => [target.id, status.kind]))
      .toEqual([["phone-portrait", "invalid"], ["play-feature-graphic", "exact"]]);
  });
});
