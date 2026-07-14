// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import type { SelectionRef } from "./editor-selection.js";
import { recordProjectChange, redoProjectChange, undoProjectChange } from "./editor-history.js";

function makeProject(id: string, screenId: string, elementId: string): Project {
  return {
    meta: { name: id, schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: screenId,
      name: screenId,
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: [{
        id: elementId,
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        content: id,
        fontFamily: "Inter",
        size: 24,
        weight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        align: "left",
        color: "#ffffff",
      }],
    }],
  };
}

const projectA = makeProject("A", "screen-a", "text-a");
const projectB = makeProject("B", "screen-b", "text-b");
const projectC = makeProject("C", "screen-c", "text-c");

interface HistoryState {
  project: Project | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: Project[];
  historyFuture: Project[];
  historyGroupKey: string | null;
}

function makeHistoryState(project: Project): HistoryState {
  return {
    project,
    activeScreenId: project.screens[0]?.id ?? null,
    selectedItems: [],
    historyPast: [],
    historyFuture: [],
    historyGroupKey: null,
  };
}

describe("editor history transitions", () => {
  it("coalesces equal non-null group keys and bounds history at 50 projects", () => {
    const first = recordProjectChange(makeHistoryState(projectA), projectB, "element:s1:e1");
    const second = recordProjectChange(
      { ...makeHistoryState(projectB), ...first },
      projectC,
      "element:s1:e1",
    );
    expect(second.historyPast).toEqual([projectA]);
    expect(second.historyFuture).toEqual([]);

    let state = makeHistoryState(projectA);
    for (let index = 0; index < 51; index += 1) {
      const next = makeProject(`next-${index}`, `screen-${index}`, `text-${index}`);
      state = { ...state, ...recordProjectChange(state, next) };
    }
    expect(state.historyPast).toHaveLength(50);
  });

  it("undoes and redoes while reconciling active screen and owner-aware selection", () => {
    const undone = undoProjectChange({
      ...makeHistoryState(projectB),
      activeScreenId: "screen-b",
      selectedItems: [{ screenId: "screen-a", elementId: "text-a" }],
      historyPast: [projectA],
    });
    expect(undone.project).toBe(projectA);
    expect(undone.activeScreenId).toBe("screen-a");
    expect(undone.selectedItems).toEqual([{ screenId: "screen-a", elementId: "text-a" }]);
    expect(redoProjectChange(undone).project).toBe(projectB);
  });
});
