// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTextElement, getLayout, parseProject, type Element, type Screen } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { ApplyScopeFooter, applyScopeOptions, applyScopeSummary, resolveApplyScope } from "./ApplyScopeControl";

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
      "Edits change 2 screens in EN, one undo step. 1 destination skipped: no screen named “Hero” at this position.",
    );
  });
});

describe("applyScopeOptions", () => {
  it("names the whole size, including a size name that contains a separator", () => {
    const only = (target: typeof hero) => applyScopeOptions(target, DEFAULT_STORE_SPECS)[0].label;
    expect(only(hero)).toBe("Only Dynamic Island · Medium");
    expect(only(layout.screens[1]!)).toBe("Only Dynamic Island · Large");
    expect(only(layout.screens[2]!)).toBe('Only 13"');
  });

  it("drops only Portrait and leads with the family when the size has no name of its own", () => {
    const only = (platform: Screen["platform"], device: Screen["device"], storeTargetId: string) =>
      applyScopeOptions({ ...hero, platform, device, storeTargetId } as Screen, DEFAULT_STORE_SPECS)[0].label;
    expect(only("apple", "iphone", "6.3-landscape")).toBe("Only Dynamic Island · Medium · Landscape");
    expect(only("apple", "iphone", "duo-inner-landscape")).toBe("Only Duo inner · Landscape");
    expect(only("apple", "ipad", "13-landscape")).toBe('Only 13" · Landscape');
    expect(only("android", "phone", "phone-portrait")).toBe("Only Phone · Portrait");
    expect(only("android", "phone", "phone-portrait-high-res")).toBe("Only Phone · High-res");
    expect(only("apple", "visionos", "vision-pro")).toBe("Only Apple Vision Pro · Landscape");
  });

  it("gives every size in the catalog its own name, never a bare orientation", () => {
    for (const [platform, { families }] of Object.entries(DEFAULT_STORE_SPECS.platforms)) {
      for (const [device, { targets }] of Object.entries(families)) {
        const names = targets.map(({ id }) =>
          applyScopeOptions({ ...hero, platform, device, storeTargetId: id } as Screen, DEFAULT_STORE_SPECS)[0].label);
        expect(new Set(names).size, `${platform}/${device}: ${names.join(", ")}`).toBe(names.length);
        for (const name of names) expect(name).not.toMatch(/^Only (?:Portrait|Landscape|Square)\b/);
      }
    }
  });

  it("shows the size alone in the picker trigger", () => {
    expect(applyScopeOptions(hero, DEFAULT_STORE_SPECS)[0].triggerLabel).toBe("Dynamic Island · Medium");
    expect(applyScopeOptions(hero, null)[0]).toMatchObject({ label: "Only this size", triggerLabel: "This size" });
  });
});

describe("ApplyScopeFooter", () => {
  const footer = (value: "screen" | "destinations") => renderToStaticMarkup(React.createElement(ApplyScopeFooter, {
    layout, screen: hero, specs: DEFAULT_STORE_SPECS, value, onChange: () => undefined,
  }));

  it("is one picker row while the edit stays on this screen", () => {
    const markup = footer("screen");
    expect(markup).toContain('aria-label="Apply to"');
    expect(markup.replace(/<[^>]+>/g, "")).toContain("Apply toDynamic Island · Medium");
    expect(markup).not.toContain("Edits change");
  });

  it("counts and names skips once the scope reaches other screens", () => {
    expect(footer("destinations")).toContain("Edits change 2 screens in EN, one undo step.");
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
