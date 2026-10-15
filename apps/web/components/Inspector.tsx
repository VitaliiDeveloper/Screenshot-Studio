// SPDX-License-Identifier: Apache-2.0
"use client";

import { useId, useState } from "react";
import { useStore } from "zustand";
import { Combine, Copy, EyeOff, Lock, LockOpen, PanelRightClose, Trash2, Ungroup } from "lucide-react";
import { findStoreTarget, leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";
import { getScreen, type Element } from "@screenshot-studio/core/model";
import { editorStore, type ElementPatchFor } from "@web/lib/editor-store";
import { mutateAndSave, mutateAndScheduleSave } from "@web/lib/mutate-and-save";
import { flushScheduledSave } from "@web/lib/debounced-save";
import type { MediaAssetTarget } from "@web/lib/editor-workspace";
import { cx, editorUi } from "./editor-ui";
import { ElementTypeInspectorSections } from "./inspector/ElementTypeInspectorSections";
import { InspectorSection as Section } from "./inspector/InspectorSection";
import { InspectorTabs, inspectorPanelId, inspectorTabId } from "./inspector/InspectorTabs";
import { ScreenInspectorSections } from "./inspector/ScreenInspectorSections";
import { deriveInspectorSelection } from "./inspector/inspector-selection-model";
import {
  inspectorHeading,
  inspectorSelectionKey,
  resolveInspectorTab,
  type InspectorTabChoice,
} from "./inspector/inspector-tab-model";
import { TransformInspectorFields } from "./inspector/TransformInspectorFields";

function patch<T extends Element["type"]>(
  id: string,
  type: T,
  change: ElementPatchFor<NoInfer<T>>,
) {
  mutateAndScheduleSave(() => editorStore.getState().patchElement({ id, type, patch: change }));
}

/** Composition entry point for selection, element, and active-screen inspector sections. */
export function Inspector({
  specs,
  onOpenBackgroundAsset,
  onOpenDeviceFrameAsset,
  onOpenMediaAsset,
  onClose,
  className,
}: {
  specs: StoreSpecs | null;
  onOpenBackgroundAsset?: () => void;
  onOpenDeviceFrameAsset?: (target: { elementId: string; screenId: string }) => void;
  onOpenMediaAsset?: (target: MediaAssetTarget) => void;
  onClose?: () => void;
  className?: string;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const selectedItems = useStore(editorStore, (state) => state.selectedItems);
  const [tabChoice, setTabChoice] = useState<InspectorTabChoice | null>(null);
  const idPrefix = useId();

  if (!project || !activeLayoutId || !activeScreenId) {
    return <aside className={cx("w-72 shrink-0 border-l border-slate-200 bg-white", className)} />;
  }
  const {
    screen,
    element,
    effectiveLocked,
    aggregate,
    selectedElements,
    everyLocked,
    everyHidden,
    canGroup,
    canUngroup,
    canDuplicate,
  } = deriveInspectorSelection(project, activeLayoutId, activeScreenId, selectedItems);
  const selectionKey = inspectorSelectionKey(selectedItems);
  const tab = resolveInspectorTab(selectionKey, tabChoice);
  // Screen-tab store actions edit the active screen, so the tab shows that screen.
  const activeScreen = getScreen(project, activeLayoutId, activeScreenId);
  const [title, subtitle] = inspectorHeading({
    tab,
    activeScreenName: activeScreen.name,
    selectedElements,
    selectionScreenName: screen.name,
  });
  const layout = project.layouts.find((candidate) => candidate.id === activeLayoutId)!;
  const target = specs
    ? (() => {
        try {
          const targetId = activeScreen.storeTargetId
            ?? leadStoreSizeId(specs, activeScreen.platform, activeScreen.device);
          return findStoreTarget(specs, activeScreen.platform, activeScreen.device, targetId);
        } catch {
          return undefined;
        }
      })()
    : undefined;
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
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex min-h-14 items-center justify-between gap-2 px-4">
          <div className="min-w-0">
            <h2 className="sr-only">Inspector</h2>
            <p className="truncate text-sm font-semibold tracking-tight text-slate-950">{title}</p>
            <p className="truncate text-[10px] text-slate-600">{subtitle}</p>
          </div>
          {onClose ? (
            <button type="button" aria-label="Close inspector" className={editorUi.iconButton} onClick={onClose}>
              <PanelRightClose size={16} strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
        <InspectorTabs
          tab={tab}
          idPrefix={idPrefix}
          onSelect={(next) => setTabChoice({ tab: next, selectionKey })}
        />
      </header>
      <div role="tabpanel" id={inspectorPanelId(idPrefix)} aria-labelledby={inspectorTabId(idPrefix, tab)}>
        {tab === "screen" ? (
          <ScreenInspectorSections
            layout={layout}
            screen={activeScreen}
            specs={specs}
            target={target}
            onOpenBackgroundAsset={onOpenBackgroundAsset}
          />
        ) : selectedItems.length > 1 ? (
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
            <Section title="Shared actions">
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
                  aria-keyshortcuts="Control+D Meta+D"
                  disabled={!canDuplicate}
                  onClick={() => mutateAndSave(() => editorStore.getState().duplicateSelected())}
                >
                  <Copy size={14} /> Duplicate
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
            <Section title="Hidden">
              <p className="text-[11px] leading-4 text-slate-500">
                Resize, rotation, and type-specific fields such as text, fill, and media edit one layer
                at a time. Select a single layer to change them.
              </p>
            </Section>
          </>
        ) : element ? (
          <>
            <Section title="Transform">
              <TransformInspectorFields
                key={`${selectedItems[0]?.screenId ?? screen.id}:${element.id}`}
                element={element}
                artboard={screen.artboard}
                effectiveLocked={effectiveLocked}
                onChange={(change) => patch(element.id, element.type, change)}
                onInteractionEnd={() => editorStore.getState().endHistoryGroup()}
              />
            </Section>
            <ElementTypeInspectorSections
              element={element}
              fonts={project.fonts}
              onPatch={patch}
              onDuplicate={() => mutateAndSave(() => editorStore.getState().duplicateSelected())}
              onUngroup={() => mutateAndSave(() => editorStore.getState().ungroupSelected())}
              screen={screen}
              effectiveLocked={effectiveLocked}
              onChooseDeviceFrameAsset={element.type === "device-frame" && selectedItems[0]
                ? () => onOpenDeviceFrameAsset?.({
                  elementId: element.id,
                  screenId: selectedItems[0]!.screenId,
                })
                : undefined}
              onChooseMediaAsset={element.type === "screenshot" || element.type === "image"
                ? () => onOpenMediaAsset?.({
                  elementId: element.id,
                  screenId: selectedItems[0]!.screenId,
                  elementType: element.type,
                })
                : undefined}
              onRemoveElement={() => mutateAndSave(() => editorStore.getState().removeElement(
                element.id,
                selectedItems[0]!.screenId,
              ))}
            />
          </>
        ) : (
          <p className="px-4 py-6 text-xs leading-5 text-slate-500">
            Select a layer on the canvas or in the Layers list to edit it.
          </p>
        )}
      </div>
    </aside>
  );
}
