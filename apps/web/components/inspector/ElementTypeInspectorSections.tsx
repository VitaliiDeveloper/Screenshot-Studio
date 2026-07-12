// SPDX-License-Identifier: Apache-2.0
"use client";

import { Copy, Ungroup } from "lucide-react";
import {
  DEVICE_FRAME_IDS,
  DEVICE_FRAME_SPECS,
  ICON_IDS,
  type Element,
  type FontAsset,
} from "@screenshot-studio/core/model";
import { editorStore, type ElementPatch } from "../../lib/editor-store";
import { mutateAndSave } from "../../lib/mutate-and-save";
import { editorUi } from "../editor-ui";
import {
  ColorField,
  FontIdentityField,
  NumberField,
  SelectField,
  TextField,
  ThemeRoleField,
} from "../inspector-fields";
import { InspectorSection as Section } from "./InspectorSection";
import { MediaInspectorFields } from "./MediaInspectorFields";

export function ElementTypeInspectorSections({
  element,
  fonts,
  onPatch,
}: {
  element: Element;
  fonts: FontAsset[];
  onPatch: (id: string, patch: ElementPatch) => void;
}) {
  const patch = (change: ElementPatch) => onPatch(element.id, change);
  return (
    <>
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
          <ThemeRoleField value={element.role} onChange={(role) => patch({ role })} />
          <TextField label="Content" value={element.content} multiline onChange={(content) => patch({ content })} />
          <FontIdentityField
            fonts={fonts}
            family={element.fontFamily}
            weight={element.weight}
            onChange={({ family, weight }) => patch({ fontFamily: family, weight })}
          />
          <NumberField label="Size" value={element.size} min={1} onChange={(size) => patch({ size })} />
          <NumberField label="Line height" value={element.lineHeight} min={0.1} step={0.1} onChange={(lineHeight) => patch({ lineHeight })} />
          <NumberField label="Letter spacing" value={element.letterSpacing} onChange={(letterSpacing) => patch({ letterSpacing })} />
          <SelectField label="Align" value={element.align} options={["left", "center", "right"] as const} onChange={(align) => patch({ align })} />
          <ColorField label="Color" value={element.color} onChange={(color) => patch({ color })} />
          {element.shadow ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <ColorField label="Shadow color" value={element.shadow.color} onChange={(color) => patch({ shadow: { ...element.shadow!, color } })} />
              <NumberField label="Shadow blur" value={element.shadow.blur} min={0} max={100} onChange={(blur) => patch({ shadow: { ...element.shadow!, blur } })} />
              <NumberField label="Shadow X" value={element.shadow.offsetX} onChange={(offsetX) => patch({ shadow: { ...element.shadow!, offsetX } })} />
              <NumberField label="Shadow Y" value={element.shadow.offsetY} onChange={(offsetY) => patch({ shadow: { ...element.shadow!, offsetY } })} />
              <NumberField label="Shadow opacity" value={element.shadow.opacity} min={0} max={1} step={0.05} onChange={(opacity) => patch({ shadow: { ...element.shadow!, opacity } })} />
              <button type="button" className={editorUi.buttonSecondary} onClick={() => patch({ shadow: null })}>Remove shadow</button>
            </div>
          ) : (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => patch({
              shadow: { color: "#000000", blur: 12, offsetX: 0, offsetY: 6, opacity: 0.35 },
            })}>Add shadow</button>
          )}
        </Section>
      )}

      {element.type === "shape" && (
        <Section title="Shape">
          <ThemeRoleField value={element.role} onChange={(role) => patch({ role })} />
          <SelectField label="Kind" value={element.kind} options={["rect", "ellipse"] as const} onChange={(kind) => patch({ kind })} />
          <ColorField label="Fill" value={element.fill} onChange={(fill) => patch({ fill })} />
          {element.kind === "rect" ? <NumberField label="Radius" value={element.radius} min={0} onChange={(radius) => patch({ radius })} /> : null}
          {element.gradient ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <ColorField label="Gradient from" value={element.gradient.from} onChange={(from) => patch({ gradient: { ...element.gradient!, from } })} />
              <ColorField label="Gradient to" value={element.gradient.to} onChange={(to) => patch({ gradient: { ...element.gradient!, to } })} />
              <NumberField label="Gradient angle" value={element.gradient.angle} min={0} max={360} integer onChange={(angle) => patch({ gradient: { ...element.gradient!, angle } })} />
              <button type="button" className={editorUi.buttonSecondary} onClick={() => patch({ gradient: null })}>Use solid fill</button>
            </div>
          ) : (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => patch({
              gradient: { from: element.fill, to: "#000000", angle: 0 },
            })}>Add gradient</button>
          )}
          {element.stroke ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <ColorField label="Stroke color" value={element.stroke.color} onChange={(color) => patch({ stroke: { ...element.stroke!, color } })} />
              <NumberField label="Stroke width" value={element.stroke.width} min={0.1} max={100} step={0.5} onChange={(width) => patch({ stroke: { ...element.stroke!, width } })} />
              <button type="button" className={editorUi.buttonSecondary} onClick={() => patch({ stroke: null })}>Remove stroke</button>
            </div>
          ) : (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => patch({
              stroke: { color: "#FFFFFF", width: 4 },
            })}>Add stroke</button>
          )}
        </Section>
      )}

      {element.type === "screenshot" && (
        <Section title="Screenshot">
          <MediaInspectorFields element={element} onChange={patch} />
        </Section>
      )}

      {element.type === "image" && (
        <Section title="Image">
          <MediaInspectorFields element={element} onChange={patch} />
        </Section>
      )}

      {element.type === "icon" && (
        <Section title="Icon">
          <SelectField label="Icon" value={element.icon} options={ICON_IDS} onChange={(icon) => patch({ icon })} />
          <ColorField label="Color" value={element.color} onChange={(color) => patch({ color })} />
          <NumberField label="Stroke width" value={element.strokeWidth} min={0.1} step={0.5} onChange={(strokeWidth) => patch({ strokeWidth })} />
        </Section>
      )}

      {element.type === "device-frame" && (
        <Section title="Device frame">
          <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patch({ assetUrl })} />
          <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patch({ fit })} />
          <SelectField label="Frame preset" value={element.deviceType} options={DEVICE_FRAME_IDS} onChange={(deviceType) => patch({
            deviceType,
            height: element.width / DEVICE_FRAME_SPECS[deviceType].aspectRatio,
          })} />
        </Section>
      )}
    </>
  );
}
