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
import type { ElementPatchFor } from "../../lib/editor-store";
import { editorUi, InsetPanel } from "../editor-ui";
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
  onDuplicate,
  onUngroup,
}: {
  element: Element;
  fonts: FontAsset[];
  onPatch: <T extends Element["type"]>(id: string, type: T, patch: ElementPatchFor<NoInfer<T>>) => void;
  onDuplicate: () => void;
  onUngroup: () => void;
}) {
  const patchText = (change: ElementPatchFor<"text">) => onPatch(element.id, "text", change);
  const patchShape = (change: ElementPatchFor<"shape">) => onPatch(element.id, "shape", change);
  const patchScreenshot = (change: ElementPatchFor<"screenshot">) => onPatch(element.id, "screenshot", change);
  const patchImage = (change: ElementPatchFor<"image">) => onPatch(element.id, "image", change);
  const patchIcon = (change: ElementPatchFor<"icon">) => onPatch(element.id, "icon", change);
  const patchDeviceFrame = (change: ElementPatchFor<"device-frame">) => onPatch(element.id, "device-frame", change);
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
              onClick={onDuplicate}
            >
              <Copy size={14} /> Duplicate
            </button>
            <button
              type="button"
              className={editorUi.buttonSecondary}
              aria-keyshortcuts="Control+Shift+G Meta+Shift+G"
              onClick={onUngroup}
            >
              <Ungroup size={14} /> Ungroup
            </button>
          </div>
        </Section>
      ) : null}

      {element.type === "text" && (
        <Section title="Text">
          <ThemeRoleField value={element.role} onChange={(role) => patchText({ role })} />
          <TextField label="Content" value={element.content} multiline onChange={(content) => patchText({ content })} />
          <FontIdentityField
            fonts={fonts}
            family={element.fontFamily}
            weight={element.weight}
            onChange={({ family, weight }) => patchText({ fontFamily: family, weight })}
          />
          <NumberField label="Size" value={element.size} min={1} onChange={(size) => patchText({ size })} />
          <NumberField label="Line height" value={element.lineHeight} min={0.1} step={0.1} onChange={(lineHeight) => patchText({ lineHeight })} />
          <NumberField label="Letter spacing" value={element.letterSpacing} onChange={(letterSpacing) => patchText({ letterSpacing })} />
          <SelectField label="Align" value={element.align} options={["left", "center", "right"] as const} onChange={(align) => patchText({ align })} />
          <ColorField label="Color" value={element.color} onChange={(color) => patchText({ color })} />
          {element.shadow ? (
            <InsetPanel>
              <ColorField label="Shadow color" value={element.shadow.color} onChange={(color) => patchText({ shadow: { ...element.shadow!, color } })} />
              <NumberField label="Shadow blur" value={element.shadow.blur} min={0} max={100} onChange={(blur) => patchText({ shadow: { ...element.shadow!, blur } })} />
              <NumberField label="Shadow X" value={element.shadow.offsetX} onChange={(offsetX) => patchText({ shadow: { ...element.shadow!, offsetX } })} />
              <NumberField label="Shadow Y" value={element.shadow.offsetY} onChange={(offsetY) => patchText({ shadow: { ...element.shadow!, offsetY } })} />
              <NumberField label="Shadow opacity" value={element.shadow.opacity} min={0} max={1} step={0.05} onChange={(opacity) => patchText({ shadow: { ...element.shadow!, opacity } })} />
              <button type="button" className={editorUi.buttonSecondary} onClick={() => patchText({ shadow: null })}>Remove shadow</button>
            </InsetPanel>
          ) : (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => patchText({
              shadow: { color: "#000000", blur: 12, offsetX: 0, offsetY: 6, opacity: 0.35 },
            })}>Add shadow</button>
          )}
        </Section>
      )}

      {element.type === "shape" && (
        <Section title="Shape">
          <ThemeRoleField value={element.role} onChange={(role) => patchShape({ role })} />
          <SelectField label="Kind" value={element.kind} options={["rect", "ellipse"] as const} onChange={(kind) => patchShape({ kind })} />
          <ColorField label="Fill" value={element.fill} onChange={(fill) => patchShape({ fill })} />
          {element.kind === "rect" ? <NumberField label="Radius" value={element.radius} min={0} onChange={(radius) => patchShape({ radius })} /> : null}
          {element.gradient ? (
            <InsetPanel>
              <ColorField label="Gradient from" value={element.gradient.from} onChange={(from) => patchShape({ gradient: { ...element.gradient!, from } })} />
              <ColorField label="Gradient to" value={element.gradient.to} onChange={(to) => patchShape({ gradient: { ...element.gradient!, to } })} />
              <NumberField label="Gradient angle" value={element.gradient.angle} min={0} max={360} integer onChange={(angle) => patchShape({ gradient: { ...element.gradient!, angle } })} />
              <button type="button" className={editorUi.buttonSecondary} onClick={() => patchShape({ gradient: null })}>Use solid fill</button>
            </InsetPanel>
          ) : (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => patchShape({
              gradient: { from: element.fill, to: "#000000", angle: 0 },
            })}>Add gradient</button>
          )}
          {element.stroke ? (
            <InsetPanel>
              <ColorField label="Stroke color" value={element.stroke.color} onChange={(color) => patchShape({ stroke: { ...element.stroke!, color } })} />
              <NumberField label="Stroke width" value={element.stroke.width} min={0.1} max={100} step={0.5} onChange={(width) => patchShape({ stroke: { ...element.stroke!, width } })} />
              <button type="button" className={editorUi.buttonSecondary} onClick={() => patchShape({ stroke: null })}>Remove stroke</button>
            </InsetPanel>
          ) : (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => patchShape({
              stroke: { color: "#FFFFFF", width: 4 },
            })}>Add stroke</button>
          )}
        </Section>
      )}

      {element.type === "screenshot" && (
        <Section title="Screenshot">
          <MediaInspectorFields element={element} onChange={patchScreenshot} />
        </Section>
      )}

      {element.type === "image" && (
        <Section title="Image">
          <MediaInspectorFields element={element} onChange={patchImage} />
        </Section>
      )}

      {element.type === "icon" && (
        <Section title="Icon">
          <SelectField label="Icon" value={element.icon} options={ICON_IDS} onChange={(icon) => patchIcon({ icon })} />
          <ColorField label="Color" value={element.color} onChange={(color) => patchIcon({ color })} />
          <NumberField label="Stroke width" value={element.strokeWidth} min={0.1} step={0.5} onChange={(strokeWidth) => patchIcon({ strokeWidth })} />
        </Section>
      )}

      {element.type === "device-frame" && (
        <Section title="Device frame">
          <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => patchDeviceFrame({ assetUrl })} />
          <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => patchDeviceFrame({ fit })} />
          <SelectField label="Frame preset" value={element.deviceType} options={DEVICE_FRAME_IDS} onChange={(deviceType) => patchDeviceFrame({
            deviceType,
            height: element.width / DEVICE_FRAME_SPECS[deviceType].aspectRatio,
          })} />
        </Section>
      )}
    </>
  );
}
