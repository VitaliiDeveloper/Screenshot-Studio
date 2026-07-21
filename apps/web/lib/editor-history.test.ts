// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import type { SelectionRef } from "@web/lib/editor-selection.js";
import {
  recordProjectChange,
  redoProjectChange,
  undoProjectChange,
  type LayoutContentSnapshot,
} from "@web/lib/editor-history.js";

function makeProject(id: string, screenId: string, elementId: string): Project {
  return {
    meta: { name: id, schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
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
    }],
  };
}

const projectA = makeProject("A", "screen-a", "text-a");
const projectB = makeProject("B", "screen-b", "text-b");
const projectC = makeProject("C", "screen-c", "text-c");

interface HistoryState {
  project: Project | null;
  activeLayoutId: string | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: LayoutContentSnapshot[];
  historyFuture: LayoutContentSnapshot[];
  historyGroupKey: string | null;
}

function makeHistoryState(project: Project): HistoryState {
  return {
    project,
    activeLayoutId: "primary",
    activeScreenId: project.layouts[0]!.screens[0]?.id ?? null,
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
    expect(second.historyPast).toEqual([{
      screens: projectA.layouts[0]!.screens,
      screenSetPolicies: undefined,
    }]);
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
      historyPast: [{
        screens: projectA.layouts[0]!.screens,
        screenSetPolicies: undefined,
      }],
    });
    expect(undone.project!.meta.name).toBe("B");
    expect(undone.project!.layouts[0]!.screens).toEqual(projectA.layouts[0]!.screens);
    expect(undone.activeScreenId).toBe("screen-a");
    expect(undone.selectedItems).toEqual([{ screenId: "screen-a", elementId: "text-a" }]);
    const redone = redoProjectChange(undone);
    expect(redone.project!.meta.name).toBe("B");
    expect(redone.project!.layouts[0]!.screens).toEqual(projectB.layouts[0]!.screens);
  });

  it("undoes and redoes a screen-slot policy change with its reconciled screens", () => {
    const synchronized = structuredClone(projectA);
    synchronized.layouts[0]!.screenSetPolicies = [{
      platform: "apple",
      device: "iphone",
      locale: "en",
      mode: "synchronized",
    }];
    const changed = recordProjectChange(makeHistoryState(projectA), synchronized);
    const current = { ...makeHistoryState(synchronized), ...changed };

    const undone = undoProjectChange(current);
    expect(undone.project!.layouts[0]!.screenSetPolicies).toBeUndefined();

    const redone = redoProjectChange(undone);
    expect(redone.project!.layouts[0]!.screenSetPolicies?.[0]?.mode).toBe("synchronized");
  });
});
