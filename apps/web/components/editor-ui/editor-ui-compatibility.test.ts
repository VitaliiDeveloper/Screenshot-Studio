// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import * as editorUiBarrel from "../editor-ui.js";

async function loadLeafModule(path: string) {
  return import(path).catch(() => null);
}

describe("editor UI compatibility barrel", () => {
  it("re-exports every public primitive from its focused leaf module", async () => {
    const [
      styles,
      addMenu,
      menuSelect,
      dialogShell,
      emptyResourceState,
      toolButton,
      statusMessage,
      insetPanel,
      segmentedControl,
    ] = await Promise.all([
      loadLeafModule("./styles.js"),
      loadLeafModule("./AddMenu.js"),
      loadLeafModule("./MenuSelect.js"),
      loadLeafModule("./DialogShell.js"),
      loadLeafModule("./EmptyResourceState.js"),
      loadLeafModule("./ToolButton.js"),
      loadLeafModule("./StatusMessage.js"),
      loadLeafModule("./InsetPanel.js"),
      loadLeafModule("./SegmentedControl.js"),
    ]);

    expect(
      [
        styles,
        addMenu,
        menuSelect,
        dialogShell,
        emptyResourceState,
        toolButton,
        statusMessage,
        insetPanel,
        segmentedControl,
      ].every(Boolean),
      "all focused editor UI modules should resolve",
    ).toBe(true);
    if (
      !styles
      || !addMenu
      || !menuSelect
      || !dialogShell
      || !emptyResourceState
      || !toolButton
      || !statusMessage
      || !insetPanel
      || !segmentedControl
    ) return;

    expect(editorUiBarrel.cx).toBe(styles.cx);
    expect(editorUiBarrel.editorUi).toBe(styles.editorUi);
    expect(editorUiBarrel.AddMenu).toBe(addMenu.AddMenu);
    expect(editorUiBarrel.MenuSelect).toBe(menuSelect.MenuSelect);
    expect(editorUiBarrel.DialogShell).toBe(dialogShell.DialogShell);
    expect(editorUiBarrel.EmptyResourceState).toBe(emptyResourceState.EmptyResourceState);
    expect(editorUiBarrel.ToolButton).toBe(toolButton.ToolButton);
    expect(editorUiBarrel.StatusMessage).toBe(statusMessage.StatusMessage);
    expect(editorUiBarrel.InsetPanel).toBe(insetPanel.InsetPanel);
    expect(editorUiBarrel.SegmentedControl).toBe(segmentedControl.SegmentedControl);
  });
});
