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
  code: "",
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  interactive: false,
  ownsKeys: false,
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

  it("toggles the Agent panel with ⌘J and keeps only view commands while an agent run owns the project", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "j", metaKey: true })).toBe("agent");
    expect(resolveEditorKeyboardCommand({ ...base, key: "о", ctrlKey: true, code: "KeyJ" })).toBe("agent");
    const locked = { ...base, editingLocked: true };
    for (const input of [
      { key: "z", metaKey: true },
      { key: "d", metaKey: true },
      { key: "e", metaKey: true },
      { key: "Backspace" },
      { key: "ArrowLeft" },
      { key: "t" },
      { key: "/", metaKey: true },
    ]) expect(resolveEditorKeyboardCommand({ ...locked, ...input })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...locked, key: "k", metaKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...locked, key: "j", metaKey: true })).toBe("agent");
    expect(resolveEditorKeyboardCommand({ ...locked, key: "o" })).toBe("toggle-view");
    expect(resolveEditorKeyboardCommand({ ...locked, key: "]" })).toBe("next-size");
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
    expect(resolveEditorKeyboardCommand({ ...base, key: "]", ctrlKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "o", ctrlKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "o", altKey: true })).toBeNull();
  });

  it.each([
    ["⌘Z", { key: "z", metaKey: true }],
    ["⌘G", { key: "g", ctrlKey: true }],
    ["⌘/", { key: "/", metaKey: true }],
    ["⌘K", { key: "k", metaKey: true }],
    ["⌘E", { key: "e", ctrlKey: true }],
    ["[", { key: "[" }],
    ["]", { key: "]" }],
    ["O", { key: "o" }],
  ])("%s works with a button focused, but not in a field, dialog, open menu, or key repeat", (_name, event) => {
    const keys = { ...base, ...event };
    expect(resolveEditorKeyboardCommand({ ...keys, interactive: true })).not.toBeNull();
    expect(resolveEditorKeyboardCommand({ ...keys, interactive: true, ownsKeys: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...keys, modalOpen: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...keys, menuOpen: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...keys, repeat: true })).toBeNull();
  });

  it.each([
    ["Delete", { key: "Delete" }],
    ["Backspace", { key: "Backspace" }],
    ["ArrowLeft", { key: "ArrowLeft" }],
    ["T", { key: "t" }],
    ["R", { key: "r" }],
  ])("keeps %s behind the strict guard: a focused button or link owns it", (_name, event) => {
    expect(resolveEditorKeyboardCommand({ ...base, ...event })).not.toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, ...event, interactive: true })).toBeNull();
  });

  it("works without a selection or history", () => {
    const idle = { ...base, hasSelection: false, canUndo: false, canRedo: false };
    expect(resolveEditorKeyboardCommand({ ...idle, key: "k", ctrlKey: true })).toBe("search");
    expect(resolveEditorKeyboardCommand({ ...idle, key: "]" })).toBe("next-size");
  });
});

describe("keyboard layouts", () => {
  it("falls back to the physical key where the layout has no Latin letter", () => {
    const cyrillic = (key: string, code: string, modifiers: object = {}) => (
      resolveEditorKeyboardCommand({ ...base, key, code, ...modifiers })
    );

    expect(cyrillic("л", "KeyK", { metaKey: true })).toBe("search");
    expect(cyrillic("у", "KeyE", { ctrlKey: true })).toBe("export");
    expect(cyrillic("я", "KeyZ", { metaKey: true })).toBe("undo");
    expect(cyrillic("я", "KeyZ", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(cyrillic("щ", "KeyO")).toBe("toggle-view");
    expect(cyrillic("е", "KeyT")).toBe("add-text");
    expect(cyrillic("к", "KeyR")).toBe("add-shape");
    expect(cyrillic("х", "BracketLeft")).toBe("prev-size");
    expect(cyrillic("ї", "BracketRight")).toBe("next-size");
    expect(cyrillic("Dead", "KeyO")).toBe("toggle-view");
  });

  it("keeps a Latin layout's own letters, so AZERTY's Z stays on the Z key", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "z", code: "KeyW", metaKey: true })).toBe("undo");
    expect(resolveEditorKeyboardCommand({ ...base, key: "w", code: "KeyZ", metaKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "a", code: "KeyQ", metaKey: true })).toBeNull();
  });

  it("does not turn Option-produced characters into letters", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "ø", code: "KeyO", altKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "˚", code: "KeyK", metaKey: true, altKey: true })).toBeNull();
  });

  it("accepts brackets typed with Option or AltGr, but not with ⌘ or Ctrl alone", () => {
    expect(resolveEditorKeyboardCommand({ ...base, key: "[", code: "Digit5", altKey: true })).toBe("prev-size");
    expect(resolveEditorKeyboardCommand({ ...base, key: "]", code: "Digit9", ctrlKey: true, altKey: true }))
      .toBe("next-size");
    expect(resolveEditorKeyboardCommand({ ...base, key: "[", code: "BracketLeft", metaKey: true })).toBeNull();
    expect(resolveEditorKeyboardCommand({ ...base, key: "]", code: "BracketRight", ctrlKey: true })).toBeNull();
  });
});

describe("routeEditorKeyDown", () => {
  const handlers = (): EditorKeyboardHandlers => ({
    onOpenDialog: vi.fn(),
    onSearch: vi.fn(),
    onToggleAgent: vi.fn(),
    onExport: vi.fn(),
    onToggleView: vi.fn(),
    onStepSize: vi.fn(),
  });
  const press = (key: string, modifiers: Partial<KeyboardEvent>, target: unknown = null) => {
    const event = {
      key,
      code: "",
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
    const cyrillicSearch = press("л", { ctrlKey: true, code: "KeyK" });
    routeEditorKeyDown(cyrillicSearch, wired);

    expect(search.preventDefault).toHaveBeenCalledOnce();
    expect(exportEvent.preventDefault).toHaveBeenCalledOnce();
    expect(cyrillicSearch.preventDefault).toHaveBeenCalledOnce();
    expect(wired.onSearch).toHaveBeenCalledTimes(2);
    expect(wired.onExport).toHaveBeenCalledOnce();
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
