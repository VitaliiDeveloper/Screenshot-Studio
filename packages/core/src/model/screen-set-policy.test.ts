// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createShapeElement, createTextElement } from "./factories.js";
import { parseProject } from "./index.js";
import { getLayout } from "./project-layout.js";
import type { Element } from "./schema.js";
import { slotCounterpart, slotScreens } from "./screen-set-policy.js";

function text(id: string): Element {
  return { ...createTextElement({}), id };
}

function group(id: string, children: Element[]): Element {
  return { id, type: "group", x: 0, y: 0, width: 400, height: 240, children } as Element;
}

function screen(id: string, elements: Element[], target?: { variantOf?: string; storeTargetId: string }) {
  return {
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale: "en",
    artboard: target ? { width: 1206, height: 2622 } : { width: 1320, height: 2868 },
    background: { type: "solid", color: "#101827" },
    elements,
    ...target,
  };
}

const layout = getLayout(parseProject({
  meta: { name: "T", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default",
    name: "Default",
    mode: "isolated",
    screens: [
      screen("hero", [text("title"), group("pair", [text("kicker"), text("body")])]),
      screen("other", [text("other-title")]),
      screen("hero-63", [text("title-63"), group("pair-63", [text("kicker-63"), text("body-63")])], {
        variantOf: "hero",
        storeTargetId: "6.3",
      }),
      screen("hero-61", [{ ...createShapeElement({}), id: "added" }, text("title-61")], {
        variantOf: "hero",
        storeTargetId: "6.1",
      }),
      screen("standalone", [text("lone")], { storeTargetId: "6.5" }),
    ],
  }],
}), "default");
const byId = (id: string) => layout.screens.find((candidate) => candidate.id === id)!;

describe("slotScreens", () => {
  it("lists the primary screen and its variants from any member", () => {
    expect(slotScreens(layout, byId("hero-63")).map(({ id }) => id)).toEqual(["hero", "hero-63", "hero-61"]);
    expect(slotScreens(layout, byId("hero")).map(({ id }) => id)).toEqual(["hero", "hero-63", "hero-61"]);
  });

  it("keeps a standalone exact-size screen on its own", () => {
    expect(slotScreens(layout, byId("standalone")).map(({ id }) => id)).toEqual(["standalone"]);
  });
});

describe("slotCounterpart", () => {
  it("matches layers at the same position, inside groups too", () => {
    expect(slotCounterpart(byId("hero"), "title", byId("hero-63"))?.id).toBe("title-63");
    expect(slotCounterpart(byId("hero"), "body", byId("hero-63"))?.id).toBe("body-63");
    expect(slotCounterpart(byId("hero-63"), "kicker-63", byId("hero"))?.id).toBe("kicker");
    expect(slotCounterpart(byId("hero"), "title", byId("hero"))?.id).toBe("title");
  });

  it("never guesses once the layer structure differs", () => {
    expect(slotCounterpart(byId("hero"), "title", byId("hero-61"))).toBeNull();
    expect(slotCounterpart(byId("hero"), "missing", byId("hero-63"))).toBeNull();
  });
});
