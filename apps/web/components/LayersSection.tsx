// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { Fragment, useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from "react";
import { useStore } from "zustand";
import {
  Box,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Smartphone,
  Square,
  Sparkles,
  Trash2,
  Type,
  Ungroup,
  type LucideIcon,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { getScreen, type Element } from "@screenshot-studio/core/model";
import { editorStore, selectEditorLayout, type CommonElementPatch } from "@web/lib/editor/editor-store";
import { isSelected } from "@web/lib/editor/editor-selection";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { elementLabel, elementTextDescription, viewToArrayIndex } from "@web/lib/panel-helpers";
import { rowHoverControl, SortableRow, treeRowButton } from "./SortableRow";
import { handleMenuKeyboardNavigation, shouldOpenMenuUpward } from "./editor-ui/menu-behavior.js";
import { cx, editorUi } from "./editor-ui";

export function LayersHeading({
  count,
  screenName,
  showScreenContext,
}: {
  count: number;
  screenName: string;
  showScreenContext: boolean;
}) {
  return (
    <h3 className={cx(editorUi.sectionLabel, "flex min-w-0 items-center gap-1.5")}>
      <span>Layers</span>
      {showScreenContext ? <span className="truncate normal-case tracking-normal">· {screenName}</span> : null}
      <span className="shrink-0 font-medium tabular-nums tracking-normal">{count}</span>
    </h3>
  );
}

const elementIcons: Partial<Record<Element["type"], LucideIcon>> = {
  text: Type,
  shape: Square,
  screenshot: ImageIcon,
  image: ImageIcon,
  icon: Sparkles,
  "device-frame": Smartphone,
};

function ElementTypeIcon({ element, className }: { element: Element; className: string }) {
  const Icon = elementIcons[element.type] ?? Box;
  return (
    <span aria-hidden="true" className={cx("inline-flex w-3.5 shrink-0 justify-center", className, !element.visible && "opacity-50")}>
      <Icon size={14} strokeWidth={1.7} />
    </span>
  );
}

/** Row fill for a layer: idle, one of several selected (light), or the only selection (solid accent). */
type LayerTone = "idle" | "soft" | "solid";

const layerRowTone: Record<LayerTone, string> = {
  idle: "hover:bg-[var(--editor-color-surface-subtle)] focus-within:bg-[var(--editor-color-surface-subtle)]",
  soft: "bg-[var(--editor-color-accent-muted)]",
  solid: "bg-[var(--editor-color-accent)]",
};
const layerTextTone: Record<LayerTone, string> = {
  idle: "text-[color:var(--editor-color-text-default)]",
  soft: "text-[color:var(--editor-color-accent-strong)]",
  solid: "text-[color:var(--editor-color-on-accent)]",
};
const layerIconTone: Record<LayerTone, string> = {
  idle: "text-[color:var(--editor-color-text-subtle)]",
  soft: "text-[color:var(--editor-color-accent-hover)]",
  solid: "text-[color:var(--editor-color-on-accent)]",
};
/** Icon buttons in a layer row: color plus a focus ring that stays visible on the row fill. */
const layerButtonTone: Record<LayerTone, string> = {
  idle: "text-[color:var(--editor-color-text-subtle)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:ring-[var(--editor-color-focus)]",
  soft: "text-[color:var(--editor-color-accent-hover)] hover:text-[color:var(--editor-color-accent-strong)] focus-visible:ring-[var(--editor-color-focus)]",
  solid: "text-[color:var(--editor-color-on-media-muted)] hover:text-[color:var(--editor-color-on-accent)] focus-visible:ring-[var(--editor-color-on-accent)]",
};
const lockedButtonTone: Record<LayerTone, string> = {
  idle: "text-[color:var(--editor-color-text-strong)] focus-visible:ring-[var(--editor-color-focus)]",
  soft: "text-[color:var(--editor-color-accent-strong)] focus-visible:ring-[var(--editor-color-focus)]",
  solid: "text-[color:var(--editor-color-on-accent)] focus-visible:ring-[var(--editor-color-on-accent)]",
};
const nameFocusTone: Record<LayerTone, string> = {
  idle: "focus-visible:ring-[var(--editor-color-focus)]",
  soft: "focus-visible:ring-[var(--editor-color-focus)]",
  solid: "focus-visible:ring-[var(--editor-color-on-accent)]",
};
/**
 * Hover controls float over the end of the name, left of the always-visible lock, so hidden ones
 * take no room from it; `bg-inherit` takes the row fill so the name does not show through.
 */
const overlayNearLock = "absolute right-[30px] top-1/2 -translate-y-1/2 bg-inherit";
const overlayBeforeThat = "absolute right-[56px] top-1/2 -translate-y-1/2 bg-inherit";
const menuItemBase = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]";
const menuItem = `${menuItemBase} text-[color:var(--editor-color-text-muted)] hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-strong)]`;
const menuItemDanger = `${menuItemBase} text-[color:var(--editor-color-danger)] hover:bg-[var(--editor-color-danger-surface)]`;

function layerNameClass(element: Element, tone: LayerTone): string {
  return cx(
    "text-xs focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)]",
    nameFocusTone[tone],
    tone === "idle" && (element.locked || !element.visible)
      ? "text-[color:var(--editor-color-text-secondary)]"
      : layerTextTone[tone],
    !element.visible && "line-through",
  );
}

/** The overlaid hover controls would cut the chip, so it steps aside while they show; the lock stays. */
function LockedChip({ tone }: { tone: LayerTone }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded px-1.5 py-px text-[10px] group-hover:opacity-0 group-focus-within:opacity-0",
        tone === "solid"
          ? "bg-[var(--editor-color-accent-hover)] text-[color:var(--editor-color-on-accent)]"
          : "bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-muted)]",
      )}
    >
      Locked
    </span>
  );
}

/**
 * A layer row's one-line select button. A text layer's full text, when the label does not already
 * show it, is the tooltip and accessible description; otherwise the tooltip is the cut-off label.
 * The accessible name stays the label.
 */
export function LayerNameButton({
  element,
  className,
  ...props
}: { element: Element } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const descriptionId = useId();
  const label = elementLabel(element);
  const description = elementTextDescription(element);
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      title={description ?? label}
      className={cx("min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left", className)}
    >
      {label}
      {description ? <span id={descriptionId} hidden>{description}</span> : null}
    </button>
  );
}

/**
 * Layers of the active screen, nested under its row in the Screens → Layers tree. Rendered
 * reversed: top row = front-most = last in array.
 */
export function LayersSection({ onOpenAdd }: { onOpenAdd: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedItems = useStore(editorStore, (s) => s.selectedItems);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [openActionsUpward, setOpenActionsUpward] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!openActionsId) return;
    const frame = requestAnimationFrame(() => {
      const triggerRect = actionButtonRefs.current.get(openActionsId)?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (triggerRect && menuRect) {
        setOpenActionsUpward(shouldOpenMenuUpward({
          triggerTop: triggerRect.top,
          triggerBottom: triggerRect.bottom,
          menuHeight: menuRect.height,
          viewportHeight: window.innerHeight,
        }));
      }
      menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || actionButtonRefs.current.get(openActionsId)?.contains(target)) return;
      setOpenActionsId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenActionsId(null);
      actionButtonRefs.current.get(openActionsId)?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openActionsId]);
  if (!project || !layout || !activeScreenId) return null;
  const screen = getScreen(project, layout.id, activeScreenId);
  const elements = screen.elements;
  const rows = [...elements].reverse(); // top-of-list = front-most
  const len = elements.length;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fromView = rows.findIndex((el) => el.id === e.active.id);
    const toView = rows.findIndex((el) => el.id === e.over!.id);
    mutateAndSave(() =>
      editorStore.getState().reorderElements(viewToArrayIndex(len, fromView), viewToArrayIndex(len, toView)),
    );
  };

  const patch = (element: Element, p: CommonElementPatch) =>
    mutateAndSave(() => editorStore.getState().patchElement({
      id: element.id,
      type: element.type,
      patch: p,
      screenId: activeScreenId,
    }));

  const toneFor = (selected: boolean): LayerTone => !selected ? "idle" : selectedItems.length > 1 ? "soft" : "solid";

  return (
    <div className="pb-1">
      <header className="flex items-center justify-between py-1 pl-[42px] pr-3">
        <LayersHeading
          count={rows.length}
          screenName={screen.name}
          showScreenContext={layout.mode === "connected"}
        />
        <button
          type="button"
          aria-label="Add element"
          title="Add element"
          className={editorUi.compactAddButton}
          onClick={onOpenAdd}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((el) => el.id)} strategy={verticalListSortingStrategy}>
          <div role="list" aria-label={`Layers for ${screen.name}`}>
            {rows.map((el) => {
              const selected = isSelected(selectedItems, { screenId: activeScreenId, elementId: el.id });
              const tone = toneFor(selected);
              const menuOpen = openActionsId === el.id;
              return (
              <Fragment key={el.id}>
              <SortableRow
                id={el.id}
                role="listitem"
                className={cx("mx-2 my-px min-h-8 gap-2 rounded-[7px] py-1 pl-[34px] pr-1", layerRowTone[tone])}
                handleClassName={cx(layerButtonTone[tone], overlayNearLock)}
                trailing={
                  <button
                    type="button"
                    aria-label={el.locked ? `Unlock ${elementLabel(el)}` : `Lock ${elementLabel(el)}`}
                    title={el.locked ? "Unlock layer" : "Lock layer"}
                    className={cx(treeRowButton, el.locked ? lockedButtonTone[tone] : layerButtonTone[tone])}
                    onClick={() => patch(el, { locked: !el.locked })}
                  >
                    {el.locked ? <Lock size={12} strokeWidth={2} /> : <LockOpen size={12} strokeWidth={1.8} />}
                  </button>
                }
              >
                <ElementTypeIcon element={el} className={layerIconTone[tone]} />
                {renaming?.id === el.id ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(ev) => setRenaming({ id: el.id, value: ev.target.value })}
                    onBlur={() => { patch(el, { name: renaming.value }); setRenaming(null); }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") { patch(el, { name: renaming.value }); setRenaming(null); }
                      if (ev.key === "Escape") setRenaming(null);
                    }}
                    className="h-7 min-w-0 flex-1 rounded-[var(--editor-radius-compact)] border border-[var(--editor-color-focus-border)] bg-[var(--editor-color-surface)] px-2 text-xs text-[color:var(--editor-color-text)] outline-none ring-2 ring-[var(--editor-color-focus-subtle)]"
                  />
                ) : (
                  <LayerNameButton
                    element={el}
                    onClick={(event) => {
                      setOpenActionsId(null);
                      editorStore.getState().select(
                        el.id,
                        activeScreenId,
                        event.shiftKey || event.metaKey || event.ctrlKey ? "toggle" : "replace",
                      );
                    }}
                    onDoubleClick={() => setRenaming({ id: el.id, value: el.name ?? "" })}
                    aria-pressed={selected}
                    className={layerNameClass(el, tone)}
                  />
                )}
                {el.locked ? <LockedChip tone={tone} /> : null}
                <button
                  ref={(node) => {
                    if (node) actionButtonRefs.current.set(el.id, node);
                    else actionButtonRefs.current.delete(el.id);
                  }}
                  type="button"
                  aria-label={`More actions for ${elementLabel(el)}`}
                  title={`Actions for ${elementLabel(el)}`}
                  aria-expanded={menuOpen}
                  className={cx(
                    treeRowButton,
                    menuOpen
                      ? "absolute right-[56px] top-1/2 -translate-y-1/2 bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-default)] shadow-[var(--editor-shadow-control)] focus-visible:ring-[var(--editor-color-focus)]"
                      : cx(layerButtonTone[tone], rowHoverControl, overlayBeforeThat),
                  )}
                  onClick={() => {
                    setOpenActionsUpward(false);
                    setOpenActionsId((current) => current === el.id ? null : el.id);
                  }}
                >
                  <MoreHorizontal size={14} strokeWidth={1.9} />
                </button>
                {menuOpen ? (
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
                ) : null}
              </SortableRow>
              {el.type === "group" ? el.children.map((child) => {
                const childTone = toneFor(isSelected(selectedItems, {
                  screenId: activeScreenId,
                  elementId: child.id,
                }));
                return (
                  <div
                    key={child.id}
                    role="listitem"
                    className={cx(
                      "group relative mx-2 my-px flex min-h-8 items-center gap-2 rounded-[7px] py-1 pl-[50px] pr-1",
                      layerRowTone[childTone],
                    )}
                  >
                    <ElementTypeIcon element={child} className={layerIconTone[childTone]} />
                    <LayerNameButton
                      element={child}
                      onClick={() => editorStore.getState().select(child.id, activeScreenId)}
                      aria-pressed={childTone !== "idle"}
                      className={layerNameClass(child, childTone)}
                    />
                    {child.locked ? <LockedChip tone={childTone} /> : null}
                    <button
                      type="button"
                      className={cx(treeRowButton, layerButtonTone[childTone], rowHoverControl, overlayBeforeThat)}
                      aria-label={child.visible ? `Hide ${elementLabel(child)}` : `Show ${elementLabel(child)}`}
                      onClick={() => patch(child, { visible: !child.visible })}
                    >
                      {child.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      type="button"
                      className={cx(
                        treeRowButton,
                        rowHoverControl,
                        overlayNearLock,
                        childTone === "solid"
                          ? layerButtonTone.solid
                          : "text-[color:var(--editor-color-danger)] hover:bg-[var(--editor-color-danger-surface)] focus-visible:ring-[var(--editor-color-focus)]",
                      )}
                      aria-label={`Delete ${elementLabel(child)}`}
                      onClick={() => mutateAndSave(() => editorStore.getState().removeElement(child.id, activeScreenId))}
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      type="button"
                      className={cx(treeRowButton, child.locked ? lockedButtonTone[childTone] : layerButtonTone[childTone])}
                      aria-label={child.locked ? `Unlock ${elementLabel(child)}` : `Lock ${elementLabel(child)}`}
                      onClick={() => patch(child, { locked: !child.locked })}
                    >
                      {child.locked ? <Lock size={12} strokeWidth={2} /> : <LockOpen size={12} strokeWidth={1.8} />}
                    </button>
                  </div>
                );
              }) : null}
              </Fragment>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      {rows.length === 0 ? (
        <p className="py-2 pl-[42px] pr-3 text-[11px] text-[color:var(--editor-color-text-secondary)]">No layers in this screen.</p>
      ) : null}
    </div>
  );
}
