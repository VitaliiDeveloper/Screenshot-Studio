// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nudgeDelta,
  resolveEditorKeyboardCommand,
  routeEditorKeyDown,
  type EditorKeyboardHandlers,
} from "./editor-keyboard";

const base = {
  key: "",
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  interactive: false,
  textEntry: false,
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

describe("editor navigation shortcuts", () => {
  it("maps Search and Export on either modifier, without Shift or Alt", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "k", metaKey: true })).toBe("search");
    expect(resolveEditorKeyboardCommand({ ...base, key: "K", ctrlKey: true })).toBe("search");
    expect(resolveEditorKeyboardCommand({ ...base, key: "e", metaKey: true })).toBe("export");
    expect(resolveEditorKeyboardCommand({ ...base, key: "E", ctrlKey: true })).toBe("export");
    expect(resolveEditorKeyboardCommand({ ...base, key: "k", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "e", metaKey: true, altKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "k" })).toBeNull();
  });

  it("maps [ and ] to the previous and next size and O to Focus / Overview", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "[" })).toBe("prev-size");
    expect(resolveEditorKeyboardCommand({ ...base, key: "]" })).toBe("next-size");
    expect(resolveEditorKeyboardCommand({ ...base, key: "o" })).toBe("toggle-view");
    expect(resolveEditorKeyboardCommand({ ...base, key: "O", shiftKey: true })).toBe("toggle-view");
    expect(resolveEditorKeyboardCommand({ ...base, key: "[", metaKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "]", altKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "o", ctrlKey: true })).toBeNull();
  });

  it.each([
    ["k", { metaKey: true }],
    ["e", { ctrlKey: true }],
    ["[", {}],
    ["]", {}],
    ["o", {}],
  ])("ignores %s in input fields, dialogs, open menus, and key repeats", (key, modifiers) => {
    const event = { ...base, key, ...modifiers };
    expect(resolveEditorKeyboardCommand(event)).not.toBeNull();
    expect(resolveEditorKeyboardCommand({ ...event, interactive: true, textEntry: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...event, modalOpen: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...event, menuOpen: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...event, repeat: true })).toBeNull();
  });

  it("still fires with a button or link focused, unlike the authoring keys", () => {
    const onButton = { ...base, interactive: true };
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "k", ctrlKey: true })).toBe("search");
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "e", metaKey: true })).toBe("export");
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "[" })).toBe("prev-size");
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "]" })).toBe("next-size");
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "o" })).toBe("toggle-view");
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "t" })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...onButton, key: "z", metaKey: true })).toBeNull();
  });

  it("works without a selection or history", () => {
    const idle = { ...base, hasSelection: false, canUndo: false, canRedo: false };
    expect(resolveEditorKeyboardCommand({ ...idle, key: "k", ctrlKey: true })).toBe("search");
    expect(resolveEditorKeyboardCommand({ ...idle, key: "]" })).toBe("next-size");
  });
});

describe("routeEditorKeyDown", () => {
  const handlers = (): EditorKeyboardHandlers => ({
    onOpenDialog: vi.fn(),
    onSearch: vi.fn(),
    onExport: vi.fn(),
    onToggleView: vi.fn(),
    onStepSize: vi.fn(),
  });
  const press = (key: string, modifiers: Partial<KeyboardEvent>, target: unknown = null) => {
    const event = {
      key,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target,
      preventDefault: vi.fn(),
      ...modifiers,
    };
    return event as typeof event & KeyboardEvent;
  };

  afterEach(() => vi.unstubAllGlobals());

  it("takes Ctrl+K and Ctrl+E from the browser, which uses them to focus the address bar", () => {
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("document", { querySelector: () => null });
    const wired = handlers();

    const search = press("k", { ctrlKey: true });
    routeEditorKeyDown(search, wired);
    const exportEvent = press("e", { ctrlKey: true });
    routeEditorKeyDown(exportEvent, wired);

    expect(search.preventDefault).toHaveBeenCalledOnce();
    expect(exportEvent.preventDefault).toHaveBeenCalledOnce();
    expect(wired.onSearch).toHaveBeenCalledOnce();
    expect(wired.onExport).toHaveBeenCalledOnce();
  });

  it("classifies the focused element: a button still routes, a text field does not", () => {
    class FakeElement {
      constructor(private readonly tag: string) {}
      closest(selector: string) {
        return selector.split(",").map((part) => part.trim()).includes(this.tag) ? this : null;
      }
    }
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", { querySelector: () => null });
    const wired = handlers();

    const fromButton = press("e", { ctrlKey: true }, new FakeElement("button"));
    routeEditorKeyDown(fromButton, wired);
    routeEditorKeyDown(press("]", {}, new FakeElement("button")), wired);
    const fromInput = press("e", { ctrlKey: true }, new FakeElement("input"));
    routeEditorKeyDown(fromInput, wired);
    const addText = press("t", {}, new FakeElement("button"));
    routeEditorKeyDown(addText, wired);

    expect(fromButton.preventDefault).toHaveBeenCalledOnce();
    expect(wired.onExport).toHaveBeenCalledOnce();
    expect(wired.onStepSize).toHaveBeenCalledWith(1);
    expect(fromInput.preventDefault).not.toHaveBeenCalled();
    expect(addText.preventDefault).not.toHaveBeenCalled();
  });

  it("routes the size and view keys and leaves unrelated keys alone", () => {
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("document", { querySelector: () => null });
    const wired = handlers();

    routeEditorKeyDown(press("[", {}), wired);
    routeEditorKeyDown(press("]", {}), wired);
    routeEditorKeyDown(press("o", {}), wired);
    const unrelated = press("q", {});
    routeEditorKeyDown(unrelated, wired);

    expect(wired.onStepSize).toHaveBeenNthCalledWith(1, -1);
    expect(wired.onStepSize).toHaveBeenNthCalledWith(2, 1);
    expect(wired.onToggleView).toHaveBeenCalledOnce();
    expect(unrelated.preventDefault).not.toHaveBeenCalled();
  });

  it("does not route while a menu or dialog is open", () => {
    const wired = handlers();
    vi.stubGlobal("Element", class {});

    vi.stubGlobal("document", { querySelector: (selector: string) => (selector.includes("menu") ? {} : null) });
    const withMenu = press("k", { metaKey: true });
    routeEditorKeyDown(withMenu, wired);
    vi.stubGlobal("document", { querySelector: (selector: string) => (selector.includes("modal") ? {} : null) });
    const withDialog = press("]", {});
    routeEditorKeyDown(withDialog, wired);

    expect(wired.onSearch).not.toHaveBeenCalled();
    expect(wired.onStepSize).not.toHaveBeenCalled();
    expect(withMenu.preventDefault).not.toHaveBeenCalled();
    expect(withDialog.preventDefault).not.toHaveBeenCalled();
  });
});
