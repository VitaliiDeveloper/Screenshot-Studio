// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createTextElement, getLayout, parseProject, type Element } from "@screenshot-studio/core/model";
import { applyScopeSummary, resolveApplyScope } from "./ApplyScopeControl";

function screen(id: string, name: string, elements: Element[], extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale: "en",
    artboard: { width: 1206, height: 2622 },
    background: { type: "solid", color: "#101827" },
    elements,
    ...extra,
  };
}

const title = (id: string, locked = false): Element => ({ ...createTextElement({}), id, locked });

// The iPad screen at Hero's position was renamed, so All destinations must not pair it.
const layout = getLayout(parseProject({
  meta: { name: "Summary", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default",
    name: "Default",
    mode: "isolated",
    screens: [
      screen("hero", "Hero", [title("title")]),
      screen("hero-69", "Hero", [title("title-69", true)], {
        artboard: { width: 1320, height: 2868 },
        variantOf: "hero",
        storeTargetId: "6.9",
      }),
      screen("other-ipad", "Pricing", [title("title-ipad")], { device: "ipad" }),
    ],
  }],
}), "default");
const hero = layout.screens[0]!;

describe("applyScopeSummary", () => {
  it("counts only screens the edit really writes and names what it skips", () => {
    expect(applyScopeSummary(layout, hero, "screen", hero.elements[0])).toBe("Edits change this screen only.");
    expect(applyScopeSummary(layout, hero, "family", hero.elements[0])).toBe(
      "Edits change this screen only. 1 size skipped: no matching unlocked layer, or a value out of range there.",
    );
    expect(applyScopeSummary(layout, hero, "destinations")).toBe(
      "One edit across 2 exact-size screens in EN, one undo step. 1 destination skipped: no screen named “Hero” at this position.",
    );
  });
});

describe("resolveApplyScope", () => {
  it("keeps a wider scope only for the selection it was chosen on", () => {
    const choice = { scope: "family" as const, key: "hero|hero/title" };
    expect(resolveApplyScope(choice, "hero|hero/title")).toBe("family");
    expect(resolveApplyScope(choice, "hero|hero/badge")).toBe("screen");
    expect(resolveApplyScope(null, "hero|")).toBe("screen");
  });
});
