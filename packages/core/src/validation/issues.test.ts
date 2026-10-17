// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createTextElement, parseProject, type Element } from "@screenshot-studio/core/model";
import { collectLayoutIssues } from "./issues.js";

function text(id: string, content: string, visible = true) {
  return { ...createTextElement({}), id, content, visible };
}

function screen(id: string, name: string, locale: string, elements: Element[] = []) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#101827" },
    elements,
  };
}

const project = parseProject({
  meta: { name: "T", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default",
    name: "Default",
    mode: "isolated",
    screens: [
      screen("hero", "Hero", "en", [
        text("long-title", "long"),
        text("short-title", "short"),
        text("hidden-title", "long", false),
        {
          id: "group",
          type: "group",
          x: 0,
          y: 0,
          width: 400,
          height: 240,
          children: [text("group-long", "long"), text("group-hidden", "long", false)],
        } as Element,
      ]),
      screen("details", "Details", "en"),
      screen("hero-de", "Hero", "de", [text("de-long", "long")]),
    ],
  }],
});

const overflowsWhenLong = (element: { content: string }) => element.content === "long";

describe("collectLayoutIssues", () => {
  it("lists blockers first, then visible overflowing text in screen order", () => {
    expect(collectLayoutIssues(project, "default", { textOverflows: overflowsWhenLong })).toEqual([
      {
        kind: "missing-locale-screen",
        id: "missing-locale-screen:de:details",
        level: "blocker",
        layoutId: "default",
        locale: "de",
        sourceLocale: "en",
        sourceScreenId: "details",
        allSizes: false,
      },
      expect.objectContaining({ kind: "text-overflow", level: "warning", screenId: "hero", elementId: "long-title" }),
      expect.objectContaining({ kind: "text-overflow", screenId: "hero", elementId: "group-long" }),
      expect.objectContaining({ kind: "text-overflow", screenId: "hero-de", elementId: "de-long" }),
    ]);
  });

  it("skips overflow until a measurer is supplied", () => {
    expect(collectLayoutIssues(project, "default").map((issue) => issue.kind))
      .toEqual(["missing-locale-screen"]);
  });
});
