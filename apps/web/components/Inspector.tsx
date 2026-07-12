// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Combine, Copy, EyeOff, Lock, LockOpen, PanelRightClose, Trash2, Ungroup } from "lucide-react";
import {
  findElementLocation,
  getScreen,
  ICON_IDS,
  DEVICE_FRAME_IDS,
  DEVICE_FRAME_SPECS,
  type Background,
  type ImageElement,
  type Screen,
  type ScreenshotElement,
} from "@screenshot-studio/core/model";
import {
  artboardTargetStatus,
  leadStoreSizeId,
  type ArtboardTargetStatus,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
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

function editBackground(background: Background) {
  mutateAndScheduleSave(() => editorStore.getState().setBackground(background));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-slate-200 px-4 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{title}</h3>
      {children}
    </section>
  );
}

function MediaCropFields({
  element,
  onChange,
}: {
  element: ScreenshotElement | ImageElement;
  onChange: (patch: ElementPatch) => void;
}) {
  if (element.fit !== "cover") return null;
  const crop = element.crop ?? { x: 0.5, y: 0.5, zoom: 1 };
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cover crop</p>
      <NumberField label="Focal X %" value={crop.x * 100} min={0} max={100} integer onChange={(x) => onChange({ crop: { ...crop, x: x / 100 } })} />
      <NumberField label="Focal Y %" value={crop.y * 100} min={0} max={100} integer onChange={(y) => onChange({ crop: { ...crop, y: y / 100 } })} />
      <NumberField label="Crop zoom" value={crop.zoom} min={1} max={4} step={0.1} onChange={(zoom) => onChange({ crop: { ...crop, zoom } })} />
      {element.crop ? (
        <button type="button" className={editorUi.buttonSecondary} onClick={() => onChange({ crop: null })}>
          Reset crop
        </button>
      ) : null}
    </div>
  );
}

function MasterArtboardEditor({
  screen,
  leadTarget,
  leadStatus,
}: {
  screen: Screen;
  leadTarget: StoreSize | undefined;
  leadStatus: ArtboardTargetStatus | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(screen.artboard.width);
  const [height, setHeight] = useState(screen.artboard.height);

  const draftStatus = leadTarget ? artboardTargetStatus({ width, height }, leadTarget) : undefined;
  const isExactLead = leadStatus?.kind === "exact";
  const resize = (size: { width: number; height: number }) => {
    mutateAndSave(() => editorStore.getState().resizeArtboard(size));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">Custom size</span>
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Explicit override</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
          <NumberField label="W" value={width} min={1} integer layout="column" onChange={setWidth} />
          <span className="pb-2 text-xs text-slate-400" aria-hidden="true">×</span>
          <NumberField label="H" value={height} min={1} integer layout="column" onChange={setHeight} />
          <span className="pb-2 text-[10px] text-slate-400">px</span>
        </div>
        <p className={`text-[10px] leading-4 ${draftStatus?.kind === "invalid" ? "text-red-600" : "text-slate-500"}`}>
          {draftStatus?.kind === "invalid"
            ? "Custom dimensions must keep the lead target aspect ratio."
            : "Apply resizes every master screen in this output and fits each composition."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className={editorUi.buttonSecondary} onClick={() => setEditing(false)}>Cancel</button>
          <button
            className={editorUi.buttonPrimary}
            disabled={draftStatus?.kind === "invalid" || (width === screen.artboard.width && height === screen.artboard.height)}
            onClick={() => resize({ width, height })}
          >
            Apply size
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">Master size</span>
        <span role="group" aria-label="Master size mode" className="inline-flex gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            aria-label="Use fixed lead size"
            aria-pressed={isExactLead}
            className={`inline-flex h-6 min-w-12 items-center justify-center rounded-md px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${isExactLead ? "bg-white text-slate-800 shadow-sm" : "text-slate-600 hover:bg-white/60 hover:text-slate-800"}`}
            onClick={() => leadTarget && !isExactLead && resize({ width: leadTarget.width, height: leadTarget.height })}
          >
            <span className="text-xs leading-none">Fixed</span>
          </button>
          <button
            type="button"
            aria-label="Customize master size"
            aria-pressed={!isExactLead}
            className={`inline-flex h-6 min-w-12 items-center justify-center rounded-md px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${!isExactLead ? "bg-white text-slate-800 shadow-sm" : "text-slate-600 hover:bg-white/60 hover:text-slate-800"}`}
            onClick={() => {
              setWidth(screen.artboard.width);
              setHeight(screen.artboard.height);
              setEditing(true);
            }}
          >
            <span className="text-xs leading-none">Custom</span>
          </button>
        </span>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium tabular-nums text-slate-700">
        {screen.artboard.width} × {screen.artboard.height} px
      </div>
      <p className="text-[10px] leading-4 text-slate-500">
        {isExactLead && leadTarget
          ? `Fixed to the ${leadTarget.label} size for this output.`
          : leadStatus?.kind === "proportional" && leadTarget
            ? `Explicit custom scale for ${leadTarget.label}.`
            : "This custom size does not match the output's lead aspect ratio."}
      </p>
    </div>
  );
}

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
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedItems = useStore(editorStore, (s) => s.selectedItems);

  if (!project || !activeScreenId) return <aside className={cx("w-72 shrink-0 border-l border-slate-200 bg-white", className)} />;
  const primary = primarySelection(selectedItems);
  const screen = getScreen(project, selectedItems.length === 1 && primary ? primary.screenId : activeScreenId);
  const background = screen.background;
  const element = selectedItems.length === 1 && primary
    ? findElementLocation(screen, primary.elementId)?.element
    : undefined;
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

          {element.type === "group" ? (
            <Section title="Group">
              <p className="text-[11px] leading-4 text-slate-400">
                {element.children.length} {element.children.length === 1 ? "child" : "children"}. Resize stays uniform to preserve child transforms.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={editorUi.buttonSecondary}
                  aria-keyshortcuts="Control+D Meta+D"
                  onClick={() => mutateAndSave(() => editorStore.getState().duplicateSelected())}
                >
                  <Copy size={14} /> Duplicate
                </button>
                <button
                  type="button"
                  className={editorUi.buttonSecondary}
                  aria-keyshortcuts="Control+Shift+G Meta+Shift+G"
                  onClick={() => mutateAndSave(() => editorStore.getState().ungroupSelected())}
                >
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
              {element.shadow ? (
                <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <ColorField label="Shadow color" value={element.shadow.color} onChange={(color) => patch(element.id, { shadow: { ...element.shadow!, color } })} />
                  <NumberField label="Shadow blur" value={element.shadow.blur} min={0} max={100} onChange={(blur) => patch(element.id, { shadow: { ...element.shadow!, blur } })} />
                  <NumberField label="Shadow X" value={element.shadow.offsetX} onChange={(offsetX) => patch(element.id, { shadow: { ...element.shadow!, offsetX } })} />
                  <NumberField label="Shadow Y" value={element.shadow.offsetY} onChange={(offsetY) => patch(element.id, { shadow: { ...element.shadow!, offsetY } })} />
                  <NumberField label="Shadow opacity" value={element.shadow.opacity} min={0} max={1} step={0.05} onChange={(opacity) => patch(element.id, { shadow: { ...element.shadow!, opacity } })} />
                  <button type="button" className={editorUi.buttonSecondary} onClick={() => patch(element.id, { shadow: null })}>Remove shadow</button>
                </div>
              ) : (
                <button type="button" className={editorUi.buttonSecondary} onClick={() => patch(element.id, {
                  shadow: { color: "#000000", blur: 12, offsetX: 0, offsetY: 6, opacity: 0.35 },
                })}>Add shadow</button>
              )}
            </Section>
          )}

          {element.type === "shape" && (
            <Section title="Shape">
              <ThemeRoleField value={element.role} onChange={(role) => patch(element.id, { role })} />
              <SelectField label="Kind" value={element.kind} options={["rect", "ellipse"] as const} onChange={(kind) => patch(element.id, { kind })} />
              <ColorField label="Fill" value={element.fill} onChange={(fill) => patch(element.id, { fill })} />
              {element.kind === "rect" ? <NumberField label="Radius" value={element.radius} min={0} onChange={(radius) => patch(element.id, { radius })} /> : null}
              {element.gradient ? (
                <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <ColorField label="Gradient from" value={element.gradient.from} onChange={(from) => patch(element.id, { gradient: { ...element.gradient!, from } })} />
                  <ColorField label="Gradient to" value={element.gradient.to} onChange={(to) => patch(element.id, { gradient: { ...element.gradient!, to } })} />
                  <NumberField label="Gradient angle" value={element.gradient.angle} min={0} max={360} integer onChange={(angle) => patch(element.id, { gradient: { ...element.gradient!, angle } })} />
                  <button type="button" className={editorUi.buttonSecondary} onClick={() => patch(element.id, { gradient: null })}>Use solid fill</button>
                </div>
              ) : (
                <button type="button" className={editorUi.buttonSecondary} onClick={() => patch(element.id, {
                  gradient: { from: element.fill, to: "#000000", angle: 0 },
                })}>Add gradient</button>
              )}
              {element.stroke ? (
                <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <ColorField label="Stroke color" value={element.stroke.color} onChange={(color) => patch(element.id, { stroke: { ...element.stroke!, color } })} />
                  <NumberField label="Stroke width" value={element.stroke.width} min={0.1} max={100} step={0.5} onChange={(width) => patch(element.id, { stroke: { ...element.stroke!, width } })} />
                  <button type="button" className={editorUi.buttonSecondary} onClick={() => patch(element.id, { stroke: null })}>Remove stroke</button>
                </div>
              ) : (
                <button type="button" className={editorUi.buttonSecondary} onClick={() => patch(element.id, {
                  stroke: { color: "#FFFFFF", width: 4 },
                })}>Add stroke</button>
              )}
            </Section>
          )}

          {element.type === "screenshot" && (
            <Section title="Screenshot">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} min={0} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
              <MediaCropFields element={element} onChange={(change) => patch(element.id, change)} />
            </Section>
          )}

          {element.type === "image" && (
            <Section title="Image">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <NumberField label="Corner radius" value={element.cornerRadius} min={0} onChange={(cornerRadius) => patch(element.id, { cornerRadius })} />
              <MediaCropFields element={element} onChange={(change) => patch(element.id, change)} />
            </Section>
          )}

          {element.type === "icon" && (
            <Section title="Icon">
              <SelectField label="Icon" value={element.icon} options={ICON_IDS} onChange={(icon) => patch(element.id, { icon })} />
              <ColorField label="Color" value={element.color} onChange={(color) => patch(element.id, { color })} />
              <NumberField label="Stroke width" value={element.strokeWidth} min={0.1} step={0.5} onChange={(strokeWidth) => patch(element.id, { strokeWidth })} />
            </Section>
          )}

          {element.type === "device-frame" && (
            <Section title="Device frame">
              <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch(element.id, { assetUrl })} />
              <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch(element.id, { fit })} />
              <SelectField label="Frame preset" value={element.deviceType} options={DEVICE_FRAME_IDS} onChange={(deviceType) => patch(element.id, {
                deviceType,
                height: element.width / DEVICE_FRAME_SPECS[deviceType].aspectRatio,
              })} />
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Artboard">
            {screen.storeTargetId ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">Target size</span>
                  <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Exact target</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium tabular-nums text-slate-700">
                  {screen.artboard.width} × {screen.artboard.height} px
                </div>
                <p className="text-[10px] leading-4 text-slate-500">This variant uses fixed Store Target dimensions.</p>
              </div>
            ) : (
              <MasterArtboardEditor
                key={`${screen.id}:${screen.artboard.width}:${screen.artboard.height}`}
                screen={screen}
                leadTarget={leadTarget}
                leadStatus={leadStatus}
              />
            )}
          </Section>
          {specs && (
            <ArtboardTargets
              project={project}
              screen={screen}
              specs={specs}
              onOpen={(screenId) => editorStore.getState().selectScreen(screenId)}
              onCreateOutput={(platform, device, leadTarget) => mutateAndSave(
                () => editorStore.getState().ensureStoreOutputFamily(platform, device, leadTarget),
              )}
              onCreate={(target) => mutateAndSave(() => editorStore.getState().ensureStoreTargetVariant(target))}
              onRemove={(rootScreenId, targetId) => mutateAndSave(
                () => editorStore.getState().removeStoreTargetVariant(rootScreenId, targetId),
              )}
            />
          )}
          <Section title="Background">
            <SelectField
              label="Type"
              value={background.type}
              options={["solid", "linear-gradient", "image"] as const}
              onChange={(type) => {
                const baseColor = background.type === "solid"
                  ? background.color
                  : background.type === "linear-gradient"
                    ? background.from
                    : background.color;
                if (type === "solid") editBackground({ type, color: baseColor });
                else if (type === "linear-gradient") {
                  editBackground({ type, from: baseColor, to: "#000000", angle: 0 });
                } else if (background.type !== "image") {
                  onOpenBackgroundAsset?.();
                }
              }}
            />
            {background.type === "solid" ? (
              <ColorField
                label="Color"
                value={background.color}
                onChange={(color) => editBackground({ ...background, color })}
              />
            ) : background.type === "linear-gradient" ? (
              <>
                <ColorField
                  label="From"
                  value={background.from}
                  onChange={(from) => editBackground({ ...background, from })}
                />
                <ColorField
                  label="To"
                  value={background.to}
                  onChange={(to) => editBackground({ ...background, to })}
                />
                <NumberField
                  label="Angle"
                  value={background.angle}
                  min={0}
                  max={360}
                  integer
                  onChange={(angle) => editBackground({ ...background, angle })}
                />
              </>
            ) : (
              <>
                <TextField
                  label="Asset URL"
                  value={background.assetUrl}
                  onChange={(assetUrl) => editBackground({ ...background, assetUrl })}
                />
                <SelectField
                  label="Fit"
                  value={background.fit}
                  options={["cover", "contain"] as const}
                  onChange={(fit) => editBackground({ ...background, fit })}
                />
                <ColorField
                  label="Fallback"
                  value={background.color}
                  onChange={(color) => editBackground({ ...background, color })}
                />
                {onOpenBackgroundAsset ? (
                  <button type="button" className={editorUi.buttonSecondary} onClick={onOpenBackgroundAsset}>
                    Choose project image
                  </button>
                ) : null}
              </>
            )}
          </Section>
        </>
      )}
    </aside>
  );
}
