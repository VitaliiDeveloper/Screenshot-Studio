// SPDX-License-Identifier: Apache-2.0
"use client";

import { useStore } from "zustand";
import { Combine, Copy, EyeOff, Lock, LockOpen, PanelRightClose, Trash2, Ungroup } from "lucide-react";
import { findElementLocation, getScreen } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { primarySelection, selectionBounds } from "../lib/editor-selection";
import { mutateAndSave, mutateAndScheduleSave } from "../lib/mutate-and-save";
import { flushScheduledSave } from "../lib/debounced-save";
import {
  NumberField,
  ColorField,
  TextField,
  SelectField,
  FontIdentityField,
  ThemeRoleField,
} from "./inspector-fields";
import { ArtboardTargets } from "./ArtboardTargets";
import { cx, editorUi } from "./editor-ui";

/**
 * The right-hand inspector. When an element is selected it shows a Transform section plus a
 * per-type section; with no selection it edits the active screen's artboard + background.
 * Every edit patches the store (live canvas) then schedules a debounced save (spec §3, §4).
 */
function patch(id: string, p: ElementPatch) {
  mutateAndScheduleSave(() => editorStore.getState().patchElement(id, p));
}

function editArtboard(patch: { width?: number; height?: number }) {
  mutateAndScheduleSave(() => editorStore.getState().patchArtboard(patch));
}

function editBackground(color: string) {
  mutateAndScheduleSave(() => editorStore.getState().patchBackground({ color }));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-slate-200 px-4 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export function Inspector({
  specs,
  onClose,
  className,
}: {
  specs: StoreSpecs | null;
  onClose?: () => void;
  className?: string;
}) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedItems = useStore(editorStore, (s) => s.selectedItems);

  if (!project || !activeScreenId) return <aside className={cx("w-72 shrink-0 border-l border-slate-200 bg-white", className)} />;
  const primary = primarySelection(selectedItems);
  const screen = getScreen(project, selectedItems.length === 1 && primary ? primary.screenId : activeScreenId);
  const element = selectedItems.length === 1 && primary
    ? findElementLocation(screen, primary.elementId)?.element
    : undefined;
  const aggregate = selectedItems.length > 1
    ? selectionBounds(project, activeScreenId, selectedItems)
    : null;
  const selectedElements = selectedItems.flatMap((selection) => {
    const owner = project.screens.find((candidate) => candidate.id === selection.screenId);
    const selected = owner ? findElementLocation(owner, selection.elementId)?.element : undefined;
    return selected ? [selected] : [];
  });
  const everyLocked = selectedElements.length > 0 && selectedElements.every((candidate) => candidate.locked);
  const everyHidden = selectedElements.length > 0 && selectedElements.every((candidate) => !candidate.visible);
  const selectedLocations = selectedItems.map((selection) => {
    const owner = project.screens.find((candidate) => candidate.id === selection.screenId);
    return { selection, location: owner ? findElementLocation(owner, selection.elementId) : null };
  });
  const canGroup = selectedItems.length >= 2
    && new Set(selectedItems.map((item) => item.screenId)).size === 1
    && selectedLocations.every(({ location }) => location && !location.parent && location.element.type !== "group");
  const canUngroup = selectedItems.length > 0
    && selectedLocations.every(({ location }) => location && !location.parent && location.element.type === "group");

  return (
    <aside className={cx(
      "flex h-full w-[min(18rem,calc(100vw-3.5rem))] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl shadow-slate-950/10 xl:w-72 xl:shadow-[-1px_0_0_rgba(15,23,42,0.02)]",
      className,
    )} onBlurCapture={() => {
      editorStore.getState().endHistoryGroup();
      void flushScheduledSave().catch(() => undefined);
    }}>
      <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-950">Inspect</h2>
          <p className="text-[10px] text-slate-400">
            {selectedItems.length > 1 ? `${selectedItems.length} elements` : element ? element.type : screen.name}
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
                disabled={!canGroup}
                onClick={() => mutateAndSave(() => editorStore.getState().groupSelected())}
              >
                <Combine size={14} /> Group
              </button>
              <button
                type="button"
                className={editorUi.buttonSecondary}
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

          {element.type === "group" ? (
            <Section title="Group">
              <p className="text-[11px] leading-4 text-slate-400">
                {element.children.length} {element.children.length === 1 ? "child" : "children"}. Resize stays uniform to preserve child transforms.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={editorUi.buttonSecondary} onClick={() => mutateAndSave(() => editorStore.getState().duplicateSelected())}>
                  <Copy size={14} /> Duplicate
                </button>
                <button type="button" className={editorUi.buttonSecondary} onClick={() => mutateAndSave(() => editorStore.getState().ungroupSelected())}>
                  <Ungroup size={14} /> Ungroup
                </button>
              </div>
            </Section>
          ) : null}

          {element.type === "text" && (
            <Section title="Text">
              <ThemeRoleField value={element.role} onChange={(role) => patch(element.id, { role })} />
              <TextField label="Content" value={element.content} multiline onChange={(content) => patch(element.id, { content })} />
              <FontIdentityField
                fonts={project.fonts}
                family={element.fontFamily}
                weight={element.weight}
                onChange={({ family, weight }) => patch(element.id, { fontFamily: family, weight })}
              />
              <NumberField label="Size" value={element.size} min={1} onChange={(size) => patch(element.id, { size })} />
              <NumberField label="Line height" value={element.lineHeight} min={0.1} step={0.1} onChange={(lineHeight) => patch(element.id, { lineHeight })} />
              <NumberField label="Letter spacing" value={element.letterSpacing} onChange={(letterSpacing) => patch(element.id, { letterSpacing })} />
              <SelectField label="Align" value={element.align} options={["left", "center", "right"] as const} onChange={(align) => patch(element.id, { align })} />
              <ColorField label="Color" value={element.color} onChange={(color) => patch(element.id, { color })} />
            </Section>
          )}

          {element.type === "shape" && (
            <Section title="Shape">
              <ThemeRoleField value={element.role} onChange={(role) => patch(element.id, { role })} />
              <ColorField label="Fill" value={element.fill} onChange={(fill) => patch(element.id, { fill })} />
              <NumberField label="Radius" value={element.radius} min={0} onChange={(radius) => patch(element.id, { radius })} />
            </Section>
          )}

          {element.type === "screenshot" && (
            <Section title="Screenshot">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} min={0} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
            </Section>
          )}

          {element.type === "image" && (
            <Section title="Image">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} min={0} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
            </Section>
          )}

          {element.type === "device-frame" && (
            <Section title="Device frame">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">Device</span>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600">{element.deviceType}</span>
              </div>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Artboard">
            <NumberField label="Width" value={screen.artboard.width} min={1} integer onChange={(width) => editArtboard({ width })} />
            <NumberField label="Height" value={screen.artboard.height} min={1} integer onChange={(height) => editArtboard({ height })} />
          </Section>
          {specs && (
            <Section title="Store targets">
              <ArtboardTargets
                screen={screen}
                specs={specs}
                onSetExact={(width, height) => editArtboard({ width, height })}
              />
            </Section>
          )}
          {screen.background.type === "solid" && (
            <Section title="Background">
              <ColorField label="Color" value={screen.background.color} onChange={editBackground} />
            </Section>
          )}
        </>
      )}
    </aside>
  );
}
