// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  handleMenuKeyboardNavigation,
  shouldOpenMenuUpward,
} from "./menu-behavior.js";

describe("menu behavior", () => {
  it("opens upward when the rendered menu does not fit below and has more room above", () => {
    expect(shouldOpenMenuUpward({
      triggerTop: 620,
      triggerBottom: 652,
      menuHeight: 180,
      viewportHeight: 700,
    })).toBe(true);
  });

  it("keeps the menu below when it fits", () => {
    expect(shouldOpenMenuUpward({
      triggerTop: 80,
      triggerBottom: 112,
      menuHeight: 180,
      viewportHeight: 700,
    })).toBe(false);
  });

  it.each([
    ["ArrowDown", 1, 2],
    ["ArrowDown", 2, 0],
    ["ArrowUp", 0, 2],
    ["Home", 2, 0],
    ["End", 0, 2],
  ])("moves focus for %s", (key, activeIndex, expectedIndex) => {
    const buttons = Array.from({ length: 3 }, () => ({ focus: vi.fn() }));
    const preventDefault = vi.fn();
    const event = {
      key,
      preventDefault,
      currentTarget: {
        ownerDocument: { activeElement: buttons[activeIndex] },
        querySelectorAll: vi.fn(() => buttons),
      },
    };

    expect(handleMenuKeyboardNavigation(event as never, "[role='menuitem']")).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(buttons[expectedIndex]!.focus).toHaveBeenCalledOnce();
  });

  it("ignores unsupported keys and empty menus", () => {
    const preventDefault = vi.fn();
    const target = {
      ownerDocument: { activeElement: null },
      querySelectorAll: vi.fn(() => []),
    };

    expect(handleMenuKeyboardNavigation({ key: "Escape", preventDefault, currentTarget: target } as never, "button")).toBe(false);
    expect(handleMenuKeyboardNavigation({ key: "Home", preventDefault, currentTarget: target } as never, "button")).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
