// SPDX-License-Identifier: Apache-2.0
import type { KeyboardEvent } from "react";

export interface MenuPlacementInput {
  triggerTop: number;
  triggerBottom: number;
  menuHeight: number;
  viewportHeight: number;
}

export function shouldOpenMenuUpward({
  triggerTop,
  triggerBottom,
  menuHeight,
  viewportHeight,
}: MenuPlacementInput): boolean {
  const spaceBelow = viewportHeight - triggerBottom;
  return spaceBelow < menuHeight && triggerTop > spaceBelow;
}

const MENU_NAVIGATION_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"] as const;
type MenuNavigationKey = (typeof MENU_NAVIGATION_KEYS)[number];

function isMenuNavigationKey(key: string): key is MenuNavigationKey {
  return MENU_NAVIGATION_KEYS.some((candidate) => candidate === key);
}

export function handleMenuKeyboardNavigation(
  event: KeyboardEvent<HTMLElement>,
  itemSelector: string,
): boolean {
  if (!isMenuNavigationKey(event.key)) return false;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(itemSelector));
  if (items.length === 0) return false;

  event.preventDefault();
  const current = items.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (current + 1 + items.length) % items.length
        : (current - 1 + items.length) % items.length;
  items[next]?.focus();
  return true;
}
