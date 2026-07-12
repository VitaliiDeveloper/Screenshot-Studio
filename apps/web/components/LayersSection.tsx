// SPDX-License-Identifier: Apache-2.0
"use client";

import { Fragment, useEffect, useRef, useState } from "react";
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
import { editorStore, type CommonElementPatch } from "../lib/editor-store";
import { isSelected } from "../lib/editor-selection";
import { mutateAndSave } from "../lib/mutate-and-save";
import { elementLabel, viewToArrayIndex } from "../lib/panel-helpers";
import { SortableRow } from "./SortableRow";
import { cx, editorUi } from "./editor-ui";

const elementIcons: Partial<Record<Element["type"], LucideIcon>> = {
  text: Type,
  shape: Square,
  screenshot: ImageIcon,
  image: ImageIcon,
  icon: Sparkles,
  "device-frame": Smartphone,
};

function ElementTypeIcon({ element }: { element: Element }) {
  const Icon = elementIcons[element.type] ?? Box;
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400",
        element.visible ? "" : "opacity-50",
      )}
    >
      <Icon size={14} strokeWidth={1.7} />
    </span>
  );
}

/** Layers list for the active screen. Rendered reversed: top row = front-most = last in array. */
export function LayersSection({ onOpenAdd }: { onOpenAdd: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedItems = useStore(editorStore, (s) => s.selectedItems);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!openActionsId) return;
    const frame = requestAnimationFrame(() => {
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
  if (!project || !activeScreenId) return null;
  const screen = getScreen(project, activeScreenId);
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

  return (
    <section className="pb-3">
      <header className="px-3 py-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            Layers
            <span className="font-medium tabular-nums tracking-normal text-slate-400">{rows.length}</span>
          </h2>
          <button
            type="button"
            aria-label="Add element"
            title="Add element"
            className={editorUi.compactAddButton}
            onClick={onOpenAdd}
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
        {project.mode === "connected" ? (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-slate-700">
            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-600">Owner</span>
            <span data-testid="layers-owner" className="truncate">{screen.name}</span>
          </p>
        ) : null}
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((el) => el.id)} strategy={verticalListSortingStrategy}>
          <div role="list" aria-label={`Layers for ${screen.name}`}>
            {rows.map((el, rowIndex) => {
              const selected = isSelected(selectedItems, { screenId: activeScreenId, elementId: el.id });
              return (
              <Fragment key={el.id}>
              <SortableRow
                id={el.id}
                role="listitem"
                className={cx(
                  "relative pr-1",
                  selected ? "bg-blue-50 ring-1 ring-blue-100" : undefined,
                )}
              >
                <ElementTypeIcon element={el} />
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
                    className="h-8 min-w-0 flex-1 rounded-lg border border-blue-400 bg-white px-2 text-xs outline-none ring-2 ring-blue-500/15"
                  />
                ) : (
                  <button
                    onClick={(event) => {
                      setOpenActionsId(null);
                      editorStore.getState().select(
                        el.id,
                        activeScreenId,
                        event.shiftKey || event.metaKey || event.ctrlKey ? "toggle" : "replace",
                      );
                    }}
                    onDoubleClick={() => setRenaming({ id: el.id, value: el.name ?? "" })}
                    className={`min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
                      selected
                        ? "font-semibold text-blue-700"
                        : "text-slate-700"
                    } ${el.visible ? "" : "text-slate-400 line-through"}`}
                  >
                    {elementLabel(el)}
                  </button>
                )}
                <button
                  ref={(node) => {
                    if (node) actionButtonRefs.current.set(el.id, node);
                    else actionButtonRefs.current.delete(el.id);
                  }}
                  type="button"
                  aria-label={`More actions for ${elementLabel(el)}`}
                  title={`Actions for ${elementLabel(el)}`}
                  aria-expanded={openActionsId === el.id}
                  className={cx(
                    editorUi.iconButton,
                    "size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    openActionsId === el.id ? "bg-white text-slate-700 opacity-100 shadow-sm" : "",
                  )}
                  onClick={() => setOpenActionsId((current) => current === el.id ? null : el.id)}
                >
                  <MoreHorizontal size={14} strokeWidth={1.9} />
                </button>
                {openActionsId === el.id ? (
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label={`${elementLabel(el)} actions`}
                    className={cx(
                      "absolute right-1 z-30 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/10",
                      rowIndex >= rows.length - 2 ? "bottom-8" : "top-8",
                    )}
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
                      if (items.length === 0) return;
                      event.preventDefault();
                      const current = items.indexOf(document.activeElement as HTMLButtonElement);
                      const next = event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? items.length - 1
                          : event.key === "ArrowDown"
                            ? (current + 1 + items.length) % items.length
                            : (current - 1 + items.length) % items.length;
                      items[next]?.focus();
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
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                      Delete
                    </button>
                  </div>
                ) : null}
              </SortableRow>
              {el.type === "group" ? el.children.map((child) => {
                const childSelected = isSelected(selectedItems, {
                  screenId: activeScreenId,
                  elementId: child.id,
                });
                return (
                  <div
                    key={child.id}
                    role="listitem"
                    className={cx(
                      "mx-2 ml-10 flex min-h-9 items-center gap-1 rounded-lg border-l border-slate-200 px-2",
                      childSelected ? "bg-blue-50 ring-1 ring-blue-100" : "bg-slate-50/60",
                    )}
                  >
                    <ElementTypeIcon element={child} />
                    <button
                      type="button"
                      onClick={() => editorStore.getState().select(child.id, activeScreenId)}
                      className={cx(
                        "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70",
                        childSelected ? "font-semibold text-blue-700" : "text-slate-600",
                        !child.visible && "line-through text-slate-400",
                      )}
                    >
                      {elementLabel(child)}
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
                      aria-label={child.locked ? `Unlock ${elementLabel(child)}` : `Lock ${elementLabel(child)}`}
                      onClick={() => patch(child, { locked: !child.locked })}
                    >
                      {child.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
                      aria-label={child.visible ? `Hide ${elementLabel(child)}` : `Show ${elementLabel(child)}`}
                      onClick={() => patch(child, { visible: !child.visible })}
                    >
                      {child.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${elementLabel(child)}`}
                      onClick={() => mutateAndSave(() => editorStore.getState().removeElement(child.id, activeScreenId))}
                    >
                      <Trash2 size={12} />
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
        <p className="px-4 py-3 text-[11px] text-slate-400">No layers in this screen.</p>
      ) : null}
    </section>
  );
}
