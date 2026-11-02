// SPDX-License-Identifier: Apache-2.0
"use client";

import type { RefObject } from "react";
import { Copy, Eye, EyeOff, Lock, LockOpen, Pencil, Trash2, Ungroup } from "lucide-react";
import type { Element } from "@screenshot-studio/core/model";
import { editorStore, type CommonElementPatch } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { elementLabel } from "@web/lib/panel-helpers";
import { handleMenuKeyboardNavigation } from "./editor-ui/menu-behavior.js";
import { cx } from "./editor-ui";

const menuItemBase = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]";
const menuItem = `${menuItemBase} text-[color:var(--editor-color-text-muted)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-strong)]`;
const menuItemDanger = `${menuItemBase} text-[color:var(--editor-color-danger-text)] hover:bg-[var(--editor-color-danger-surface)]`;

export function LayerActionsMenu({
  menuRef,
  el,
  activeScreenId,
  openActionsUpward,
  patch,
  setRenaming,
  setOpenActionsId,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  el: Element;
  activeScreenId: string;
  openActionsUpward: boolean;
  patch: (element: Element, p: CommonElementPatch) => void;
  setRenaming: (renaming: { id: string; value: string }) => void;
  setOpenActionsId: (id: string | null) => void;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${elementLabel(el)} actions`}
      className={cx(
        "absolute right-1 z-30 w-36 rounded-lg border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1 shadow-[var(--editor-shadow-menu)]",
        openActionsUpward ? "bottom-8" : "top-8",
      )}
      onKeyDown={(event) => {
        handleMenuKeyboardNavigation(event, "[role='menuitem']");
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setRenaming({ id: el.id, value: el.name ?? "" });
          setOpenActionsId(null);
        }}
        aria-label="Rename layer"
        className={menuItem}
      >
        <Pencil size={13} strokeWidth={1.8} />
        Rename
      </button>
      {el.type === "group" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              editorStore.getState().select(el.id, activeScreenId);
              mutateAndSave(() => editorStore.getState().duplicateSelected());
              setOpenActionsId(null);
            }}
            aria-label="Duplicate group"
            className={menuItem}
          >
            <Copy size={13} strokeWidth={1.8} /> Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              editorStore.getState().select(el.id, activeScreenId);
              mutateAndSave(() => editorStore.getState().ungroupSelected());
              setOpenActionsId(null);
            }}
            aria-label="Ungroup layer"
            className={menuItem}
          >
            <Ungroup size={13} strokeWidth={1.8} /> Ungroup
          </button>
        </>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patch(el, { visible: !el.visible });
          setOpenActionsId(null);
        }}
        aria-label={el.visible ? "Hide layer" : "Show layer"}
        className={menuItem}
      >
        {el.visible ? <Eye size={13} strokeWidth={1.8} /> : <EyeOff size={13} strokeWidth={1.8} />}
        {el.visible ? "Hide" : "Show"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          patch(el, { locked: !el.locked });
          setOpenActionsId(null);
        }}
        aria-label={el.locked ? "Unlock layer" : "Lock layer"}
        className={menuItem}
      >
        {el.locked ? <Lock size={13} strokeWidth={1.8} /> : <LockOpen size={13} strokeWidth={1.8} />}
        {el.locked ? "Unlock" : "Lock"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          mutateAndSave(() => editorStore.getState().removeElement(el.id, activeScreenId));
          setOpenActionsId(null);
        }}
        aria-label="Delete layer"
        className={menuItemDanger}
      >
        <Trash2 size={13} strokeWidth={1.8} />
        Delete
      </button>
    </div>
  );
}
