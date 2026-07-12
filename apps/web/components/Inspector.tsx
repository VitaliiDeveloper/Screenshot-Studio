// SPDX-License-Identifier: Apache-2.0
"use client";

import { useStore } from "zustand";
import { Combine, EyeOff, Lock, LockOpen, PanelRightClose, Trash2, Ungroup } from "lucide-react";
import { artboardTargetStatus, leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { mutateAndSave, mutateAndScheduleSave } from "../lib/mutate-and-save";
import { flushScheduledSave } from "../lib/debounced-save";
import { NumberField } from "./inspector-fields";
import { cx, editorUi } from "./editor-ui";
import { ElementTypeInspectorSections } from "./inspector/ElementTypeInspectorSections";
import { InspectorSection as Section } from "./inspector/InspectorSection";
import { ScreenInspectorSections } from "./inspector/ScreenInspectorSections";
import { deriveInspectorSelection } from "./inspector/inspector-selection-model";

function patch(id: string, change: ElementPatch) {
  mutateAndScheduleSave(() => editorStore.getState().patchElement(id, change));
}

/** Composition entry point for selection, element, and active-screen inspector sections. */
export function Inspector({
  specs,
  onOpenBackgroundAsset,
  onClose,
  className,
}: {
  specs: StoreSpecs | null;
  onOpenBackgroundAsset?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const selectedItems = useStore(editorStore, (state) => state.selectedItems);

  if (!project || !activeScreenId) {
    return <aside className={cx("w-72 shrink-0 border-l border-slate-200 bg-white", className)} />;
  }
  const {
    screen,
    element,
    aggregate,
    everyLocked,
    everyHidden,
    canGroup,
    canUngroup,
  } = deriveInspectorSelection(project, activeScreenId, selectedItems);
  const leadTarget = specs
    ? (() => {
        try {
          const leadId = leadStoreSizeId(screen.platform, screen.device);
          return specs[screen.platform]?.[screen.device]?.find((target) => target.id === leadId);
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const leadStatus = leadTarget ? artboardTargetStatus(screen.artboard, leadTarget) : undefined;
  return (
    <aside
      className={cx(
        "flex h-full w-[min(18rem,calc(100vw-3.5rem))] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl shadow-slate-950/10 xl:w-72 xl:shadow-[-1px_0_0_rgba(15,23,42,0.02)]",
        className,
      )}
      onBlurCapture={() => {
        editorStore.getState().endHistoryGroup();
        void flushScheduledSave().catch(() => undefined);
      }}
    >
      <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-950">Inspector</h2>
          <p className="text-[10px] text-slate-600">
            {selectedItems.length > 1 ? `${selectedItems.length} elements` : element ? `${element.type} element` : "Screen settings"}
          </p>
        </div>
        {onClose ? (
          <button type="button" aria-label="Close inspector" className={editorUi.iconButton} onClick={onClose}>
            <PanelRightClose size={16} strokeWidth={1.9} />
          </button>
        ) : null}
      </header>
      {selectedItems.length > 1 ? (
        <>
          <Section title="Selection">
            {aggregate ? (
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                <span>X <strong className="text-slate-700">{Math.round(aggregate.minX)}</strong></span>
                <span>Y <strong className="text-slate-700">{Math.round(aggregate.minY)}</strong></span>
                <span>Width <strong className="text-slate-700">{Math.round(aggregate.maxX - aggregate.minX)}</strong></span>
                <span>Height <strong className="text-slate-700">{Math.round(aggregate.maxY - aggregate.minY)}</strong></span>
              </div>
            ) : null}
            <p className="text-[11px] leading-4 text-slate-400">
              Drag to move the unlocked selection. Resize and rotation remain single-element actions.
            </p>
          </Section>
          <Section title="Batch actions">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={editorUi.buttonSecondary}
                aria-keyshortcuts="Control+G Meta+G"
                disabled={!canGroup}
                onClick={() => mutateAndSave(() => editorStore.getState().groupSelected())}
              >
                <Combine size={14} /> Group
              </button>
              <button
                type="button"
                className={editorUi.buttonSecondary}
                aria-keyshortcuts="Control+Shift+G Meta+Shift+G"
                disabled={!canUngroup}
                onClick={() => mutateAndSave(() => editorStore.getState().ungroupSelected())}
              >
                <Ungroup size={14} /> Ungroup
              </button>
              <button
                type="button"
                className={editorUi.buttonSecondary}
                onClick={() => mutateAndSave(() => editorStore.getState().setSelectedLocked(!everyLocked))}
              >
                {everyLocked ? <LockOpen size={14} /> : <Lock size={14} />}
                {everyLocked ? "Unlock" : "Lock"}
              </button>
              <button
                type="button"
                className={editorUi.buttonSecondary}
                onClick={() => mutateAndSave(() => editorStore.getState().setSelectedVisible(everyHidden))}
              >
                <EyeOff size={14} /> {everyHidden ? "Show" : "Hide"}
              </button>
              <button
                type="button"
                className={`${editorUi.buttonDanger} col-span-2`}
                onClick={() => mutateAndSave(() => editorStore.getState().removeSelected())}
              >
                <Trash2 size={14} /> Delete selected
              </button>
            </div>
          </Section>
        </>
      ) : element ? (
        <>
          <Section title="Transform">
            <NumberField label="X" value={element.x} onChange={(x) => patch(element.id, { x })} />
            <NumberField label="Y" value={element.y} onChange={(y) => patch(element.id, { y })} />
            {element.type === "group" ? (
              <>
                <NumberField
                  label="Width"
                  value={element.width}
                  min={1}
                  onChange={(width) => patch(element.id, {
                    width,
                    height: element.height * width / element.width,
                  })}
                />
                <NumberField
                  label="Height"
                  value={element.height}
                  min={1}
                  onChange={(height) => patch(element.id, {
                    width: element.width * height / element.height,
                    height,
                  })}
                />
              </>
            ) : (
              <>
                <NumberField label="Width" value={element.width} min={1} onChange={(width) => patch(element.id, { width })} />
                <NumberField label="Height" value={element.height} min={1} onChange={(height) => patch(element.id, { height })} />
              </>
            )}
            <NumberField label="Rotation" value={element.rotation} onChange={(rotation) => patch(element.id, { rotation })} />
            <NumberField label="Opacity" value={element.opacity} min={0} max={1} step={0.1} onChange={(opacity) => patch(element.id, { opacity })} />
          </Section>
          <ElementTypeInspectorSections element={element} fonts={project.fonts} onPatch={patch} />
        </>
      ) : (
        <ScreenInspectorSections
          project={project}
          screen={screen}
          specs={specs}
          leadTarget={leadTarget}
          leadStatus={leadStatus}
          onOpenBackgroundAsset={onOpenBackgroundAsset}
        />
      )}
    </aside>
  );
}
