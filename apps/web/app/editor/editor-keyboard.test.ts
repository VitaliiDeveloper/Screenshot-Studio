// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { nudgeDelta, resolveEditorKeyboardCommand } from "./editor-keyboard";

const base = {
  key: "",
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  interactive: false,
  modalOpen: false,
  menuOpen: false,
  canUndo: true,
  canRedo: true,
  hasSelection: true,
};

describe("editor keyboard routing", () => {
  it("maps history shortcuts without stealing unavailable commands", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "z", metaKey: true })).toBe("undo");
    expect(resolveEditorKeyboardCommand({ ...base, key: "z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(resolveEditorKeyboardCommand({ ...base, key: "y", ctrlKey: true })).toBe("redo");
    expect(resolveEditorKeyboardCommand({ ...base, key: "z", metaKey: true, canUndo: false })).toBeNull();
  });

  it("maps authoring shortcuts with their existing modifier rules", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "g", ctrlKey: true })).toBe("group");
    expect(resolveEditorKeyboardCommand({ ...base, key: "G", ctrlKey: true, shiftKey: true })).toBe("ungroup");
    expect(resolveEditorKeyboardCommand({ ...base, key: "d", metaKey: true })).toBe("duplicate");
    expect(resolveEditorKeyboardCommand({ ...base, key: "/", metaKey: true })).toBe("templates");
    expect(resolveEditorKeyboardCommand({ ...base, key: "Backspace" })).toBe("delete");
    expect(resolveEditorKeyboardCommand({ ...base, key: "t" })).toBe("add-text");
    expect(resolveEditorKeyboardCommand({ ...base, key: "r" })).toBe("add-shape");
  });

  it("nudges the selection with arrows, 10 px or 50 px with Shift", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "ArrowLeft" })).toBe("nudge");
    expect(resolveEditorKeyboardCommand({ ...base, key: "ArrowDown", shiftKey: true })).toBe("nudge");
    expect(resolveEditorKeyboardCommand({ ...base, key: "ArrowUp", hasSelection: false })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "ArrowRight", metaKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "ArrowRight", interactive: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "ArrowDown", menuOpen: true })).toBeNull();
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ x: -10, y: 0 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ x: 0, y: 50 });
    expect(nudgeDelta("a", false)).toBeNull();
  });

  it("ignores repeated, interactive, modal, and modified plain-key events", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "t", repeat: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "t", interactive: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "t", modalOpen: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "t", altKey: true })).toBeNull();
  });
});
