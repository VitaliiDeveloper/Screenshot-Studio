// SPDX-License-Identifier: Apache-2.0
"use client";

import { Fragment, useId, useState } from "react";
import { useStore } from "zustand";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Combine,
  Copy,
  EyeOff,
  Lock,
  LockOpen,
  PanelRightClose,
  Trash2,
  Ungroup,
} from "lucide-react";
import { findStoreTarget, leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";
import { getScreen, type Element } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { editorStore, type ElementPatchFor } from "@web/lib/editor/editor-store";
import { mutateAndSave, mutateAndScheduleSave } from "@web/lib/editor/mutate-and-save";
import { flushScheduledSave } from "@web/lib/editor/debounced-save";
import { typeCountLabel } from "@web/lib/panel-helpers";
import type { MediaAssetTarget } from "@web/lib/editor/editor-workspace";
import { cx, editorUi } from "@web/components/editor-ui";
import { percentToUnit, SliderNumberField, unitToPercent } from "./inspector-fields";
import { ElementTypeInspectorSections } from "./ElementTypeInspectorSections";
import { TextSizeStatusSection } from "./TextSizeStatusSection";
import { InspectorSection as Section } from "./InspectorSection";
import { InspectorTabs, inspectorPanelId, inspectorTabId } from "./InspectorTabs";
import { ScreenInspectorSections } from "./ScreenInspectorSections";
import { deriveInspectorSelection } from "./inspector-selection-model";
import {
  inspectorHeading,
  inspectorSelectionKey,
  resolveInspectorTab,
  type InspectorTabChoice,
} from "./inspector-tab-model";
import { TransformInspectorFields } from "./TransformInspectorFields";

function patch<T extends Element["type"]>(
  id: string,
  type: T,
  change: ElementPatchFor<NoInfer<T>>,
) {
  mutateAndScheduleSave(() => editorStore.getState().patchElement({ id, type, patch: change }));
}

// Lucide names the guide axis: "Vertical" icons align x edges, "Horizontal" icons align y edges.
const ALIGN_ACTIONS = [
  { action: "left", label: "Align left", Icon: AlignStartVertical },
  { action: "center", label: "Align horizontal centers", Icon: AlignCenterVertical },
  { action: "right", label: "Align right", Icon: AlignEndVertical },
  { action: "top", label: "Align top", Icon: AlignStartHorizontal },
  { action: "middle", label: "Align vertical centers", Icon: AlignCenterHorizontal },
  { action: "bottom", label: "Align bottom", Icon: AlignEndHorizontal },
] as const;

const SUBLABEL = "text-xs text-[color:var(--editor-color-text-secondary)]";
const SHORTCUT_HINT = "ml-auto text-[color:var(--editor-color-text-subtle)]";

/** Composition entry point for selection, element, and active-screen inspector sections. */
export function Inspector({
  specs,
  issues = [],
  textMeasured = false,
  onOpenBackgroundAsset,
  onOpenDeviceFrameAsset,
  onOpenMediaAsset,
  onClose,
  className,
}: {
  specs: StoreSpecs | null;
  /** The editor's live Issues; Status by size reads text fit from them. */
  issues?: readonly ProjectIssue[];
  /** Whether text overflow has been measured (project fonts settled). */
  textMeasured?: boolean;
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
    selectionTypeGroups,
    everyLocked,
    everyHidden,
    canGroup,
    canUngroup,
    canDuplicate,
    canAlign,
    canDistribute,
    sharedOpacity,
  } = deriveInspectorSelection(project, activeLayoutId, activeScreenId, selectedItems);
  const selectionKey = inspectorSelectionKey(selectedItems);
  const tab = resolveInspectorTab(selectionKey, tabChoice);
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
        "flex h-full w-[min(18rem,calc(100vw-3.75rem))] editor-scroll-area shrink-0 flex-col overflow-y-auto overflow-x-hidden border-l border-slate-200 bg-white shadow-xl shadow-slate-950/10 xl:w-72 xl:shadow-[-1px_0_0_rgba(15,23,42,0.02)]",
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
            <p className="truncate text-sm font-medium tracking-tight text-slate-950">{title}</p>
            {tab === "layer" && selectionTypeGroups.length > 1 ? (
              <p className="truncate text-[10px] text-slate-600">
                {selectionTypeGroups.map(({ type, items }, index) => {
                  const label = typeCountLabel(type, items.length);
                  return (
                    <Fragment key={type}>
                      {index > 0 ? " · " : null}
                      <button
                        type="button"
                        aria-label={`Select only ${label}`}
                        title={`Select only ${label}`}
                        className="rounded-sm underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-blue-700 hover:decoration-solid hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
                        onClick={() => editorStore.getState().setSelection(items)}
                      >
                        {label}
                      </button>
                    </Fragment>
                  );
                })}
              </p>
            ) : (
              <p className="truncate text-[10px] text-slate-600">{subtitle}</p>
            )}
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
          layerEmpty={selectedItems.length === 0}
          onSelect={(next) => setTabChoice({ tab: next, selectionKey })}
        />
      </header>
      <div
        key={tab}
        role="tabpanel"
        id={inspectorPanelId(idPrefix)}
        aria-labelledby={inspectorTabId(idPrefix, tab)}
        data-tab={tab}
        className="inspector-panel"
      >
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
            <Section title="Selection bounds">
              {aggregate ? (
                <dl className="flex flex-col gap-1.5 rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 text-xs">
                  {([
                    ["Position", [["X", aggregate.minX], ["Y", aggregate.minY]]],
                    ["Size", [["W", aggregate.maxX - aggregate.minX], ["H", aggregate.maxY - aggregate.minY]]],
                  ] as const).map(([label, axes]) => (
                    <div key={label} className="flex gap-2">
                      <dt className="w-16 shrink-0 text-slate-500">{label}</dt>
                      <dd className="grid flex-1 grid-cols-2 gap-3 tabular-nums text-slate-900">
                        {axes.map(([axis, value]) => (
                          <span key={axis}>
                            <span className="mr-1 text-slate-400">{axis}</span>
                            {Math.round(value)}
                            <span className="ml-0.5 text-slate-400">px</span>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="text-[11px] leading-4 text-slate-500">Drag on the canvas to move unlocked layers.</p>
            </Section>
            <Section title="Shared actions">
              <div className="flex flex-col gap-1.5">
                <span id={`${idPrefix}-align`} className={SUBLABEL}>Align</span>
                <div role="group" aria-labelledby={`${idPrefix}-align`} className="grid grid-cols-6 gap-1">
                  {ALIGN_ACTIONS.map(({ action, label, Icon }) => (
                    <button
                      key={action}
                      type="button"
                      aria-label={label}
                      title={label}
                      className={cx(editorUi.buttonSecondary, "!px-0")}
                      disabled={!canAlign}
                      onClick={() => mutateAndSave(() => editorStore.getState().arrangeSelected(action))}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span id={`${idPrefix}-distribute`} className={SUBLABEL}>Distribute</span>
                <div role="group" aria-labelledby={`${idPrefix}-distribute`} className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    aria-label="Distribute horizontally"
                    className={editorUi.buttonSecondary}
                    disabled={!canDistribute}
                    onClick={() => mutateAndSave(() => editorStore.getState().arrangeSelected("distribute-horizontal"))}
                  >
                    <AlignHorizontalDistributeCenter size={14} /> Horizontal
                  </button>
                  <button
                    type="button"
                    aria-label="Distribute vertically"
                    className={editorUi.buttonSecondary}
                    disabled={!canDistribute}
                    onClick={() => mutateAndSave(() => editorStore.getState().arrangeSelected("distribute-vertical"))}
                  >
                    <AlignVerticalDistributeCenter size={14} /> Vertical
                  </button>
                </div>
              </div>
              <div
                onPointerUp={() => editorStore.getState().endHistoryGroup()}
                onBlur={() => editorStore.getState().endHistoryGroup()}
              >
                <SliderNumberField
                  label="Opacity"
                  layout="inline"
                  value={unitToPercent(sharedOpacity)}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  helpText="Applies to every unlocked selected layer. Exported images are always flattened and contain no alpha channel."
                  onChange={(opacity) => mutateAndScheduleSave(
                    () => editorStore.getState().setSelectedOpacity(percentToUnit(opacity)),
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className={cx(editorUi.buttonSecondary, "!justify-start")}
                  aria-keyshortcuts="Control+G Meta+G"
                  disabled={!canGroup}
                  onClick={() => mutateAndSave(() => editorStore.getState().groupSelected())}
                >
                  <Combine size={14} /> Group
                  <span aria-hidden="true" className={SHORTCUT_HINT}>⌘G</span>
                </button>
                <button
                  type="button"
                  className={cx(editorUi.buttonSecondary, "!justify-start")}
                  aria-keyshortcuts="Control+Shift+G Meta+Shift+G"
                  disabled={!canUngroup}
                  onClick={() => mutateAndSave(() => editorStore.getState().ungroupSelected())}
                >
                  <Ungroup size={14} /> Ungroup
                </button>
                <button
                  type="button"
                  className={cx(editorUi.buttonSecondary, "!justify-start")}
                  aria-keyshortcuts="Control+D Meta+D"
                  disabled={!canDuplicate}
                  onClick={() => mutateAndSave(() => editorStore.getState().duplicateSelected())}
                >
                  <Copy size={14} /> Duplicate
                  <span aria-hidden="true" className={SHORTCUT_HINT}>⌘D</span>
                </button>
                <button
                  type="button"
                  className={cx(editorUi.buttonSecondary, "!justify-start")}
                  onClick={() => mutateAndSave(() => editorStore.getState().setSelectedLocked(!everyLocked))}
                >
                  {everyLocked ? <LockOpen size={14} /> : <Lock size={14} />}
                  {everyLocked ? "Unlock" : "Lock"}
                </button>
                <button
                  type="button"
                  className={cx(editorUi.buttonSecondary, "!justify-start")}
                  onClick={() => mutateAndSave(() => editorStore.getState().setSelectedVisible(everyHidden))}
                >
                  <EyeOff size={14} /> {everyHidden ? "Show" : "Hide"}
                </button>
                <button
                  type="button"
                  aria-label="Delete selected"
                  className={cx(editorUi.buttonDanger, "!justify-start")}
                  onClick={() => mutateAndSave(() => editorStore.getState().removeSelected())}
                >
                  <Trash2 size={14} /> Delete
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
            {element.type === "text" ? (
              <TextSizeStatusSection
                project={project}
                layoutId={activeLayoutId}
                screenId={screen.id}
                elementId={element.id}
                issues={issues}
                measured={textMeasured}
                specs={specs ?? undefined}
              />
            ) : null}
          </>
        ) : (
          <p className="px-4 py-4 text-xs leading-5 text-slate-500">
            Select a layer on the canvas or in the Layers list to edit it.
          </p>
        )}
      </div>
    </aside>
  );
}
