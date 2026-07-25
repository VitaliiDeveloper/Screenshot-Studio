// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Copy, ImagePlus, PanelsTopLeft, Smartphone, Trash2, Ungroup } from "lucide-react";
import {
  deviceFramePreset,
  ICON_IDS,
  MEDIA_BLUR_MAX,
  type DeviceFrameElement,
  type DeviceFrameId,
  type Element,
  type FontAsset,
  type Screen,
} from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "@web/lib/editor-store";
import { editorUi, InsetPanel } from "@web/components/editor-ui";
import {
  ColorField,
  NumberField,
  SelectField,
  ThemeRoleField,
} from "@web/components/inspector-fields";
import { InspectorSection as Section } from "./InspectorSection";
import { MediaInspectorFields } from "./MediaInspectorFields";
import { ContentModeControl } from "./MediaPresentationFields";
import { OptionalInspectorEffect } from "./OptionalInspectorEffect";
import { TextInspectorFields } from "./TextInspectorFields";

const DeviceFramePresetPicker = dynamic(
  () => import("../DeviceFramePresetPicker").then((module) => module.DeviceFramePresetPicker),
  { ssr: false },
);

export function deviceFrameSelectionPatch(
  element: Pick<DeviceFrameElement, "width">,
  deviceType: DeviceFrameId,
): ElementPatchFor<"device-frame"> {
  return {
    deviceType,
    height: element.width / deviceFramePreset(deviceType).recipe.spec.aspectRatio,
  };
}

export function ElementTypeInspectorSections({
  element,
  fonts,
  onPatch,
  onDuplicate,
  onUngroup,
  onChooseDeviceFrameAsset,
  onChooseMediaAsset,
  onRemoveElement,
  effectiveLocked,
  screen,
}: {
  element: Element;
  fonts: FontAsset[];
  onPatch: <T extends Element["type"]>(id: string, type: T, patch: ElementPatchFor<NoInfer<T>>) => void;
  onDuplicate: () => void;
  onUngroup: () => void;
  onChooseDeviceFrameAsset?: () => void;
  onChooseMediaAsset?: () => void;
  onRemoveElement?: () => void;
  effectiveLocked?: boolean;
  screen?: Pick<Screen, "platform" | "device" | "artboard">;
}) {
  const [framePickerOpen, setFramePickerOpen] = useState(false);
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
          <p className="text-[11px] leading-4 text-[color:var(--editor-color-text-subtle)]">
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
          <TextInspectorFields
            element={element}
            fonts={fonts}
            onChange={patchText}
          />
        </Section>
      )}

      {element.type === "shape" && (
        <Section title="Shape">
          <ThemeRoleField value={element.role} onChange={(role) => patchShape({ role })} />
          <SelectField label="Kind" value={element.kind} options={["rect", "ellipse"] as const} onChange={(kind) => patchShape({ kind })} />
          <ColorField label="Fill" value={element.fill} onChange={(fill) => patchShape({ fill })} />
          {element.kind === "rect" ? <NumberField label="Radius" value={element.radius} min={0} onChange={(radius) => patchShape({ radius })} /> : null}
          <OptionalInspectorEffect
            title="Gradient"
            description="Blend two fill colors"
            enabled={Boolean(element.gradient)}
            onAdd={() => patchShape({
              gradient: { from: element.fill, to: "#000000", angle: 0 },
            })}
            onRemove={() => patchShape({ gradient: null })}
          >
            {element.gradient ? (
              <>
              <ColorField label="Gradient from" value={element.gradient.from} onChange={(from) => patchShape({ gradient: { ...element.gradient!, from } })} />
              <ColorField label="Gradient to" value={element.gradient.to} onChange={(to) => patchShape({ gradient: { ...element.gradient!, to } })} />
              <NumberField label="Gradient angle" value={element.gradient.angle} min={0} max={360} integer onChange={(angle) => patchShape({ gradient: { ...element.gradient!, angle } })} />
              </>
            ) : null}
          </OptionalInspectorEffect>
          <OptionalInspectorEffect
            title="Stroke"
            description="Outline the shape"
            enabled={Boolean(element.stroke)}
            onAdd={() => patchShape({
              stroke: { color: "#FFFFFF", width: 4 },
            })}
            onRemove={() => patchShape({ stroke: null })}
          >
            {element.stroke ? (
              <>
              <ColorField label="Stroke color" value={element.stroke.color} onChange={(color) => patchShape({ stroke: { ...element.stroke!, color } })} />
              <NumberField label="Stroke width" value={element.stroke.width} min={0.1} max={100} step={0.5} onChange={(width) => patchShape({ stroke: { ...element.stroke!, width } })} />
              </>
            ) : null}
          </OptionalInspectorEffect>
        </Section>
      )}

      {element.type === "screenshot" && (
        <Section title="Screenshot">
          <MediaInspectorFields
            element={element}
            onChange={patchScreenshot}
            onChooseAsset={onChooseMediaAsset}
            onRemoveElement={onRemoveElement}
            effectiveLocked={effectiveLocked}
          />
        </Section>
      )}

      {element.type === "image" && (
        <Section title="Image">
          <MediaInspectorFields
            element={element}
            onChange={patchImage}
            onChooseAsset={onChooseMediaAsset}
            onRemoveElement={onRemoveElement}
            effectiveLocked={effectiveLocked}
          />
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
          <ContentModeControl value={element.fit} onChange={(fit) => patchDeviceFrame({ fit })} />
          <OptionalInspectorEffect
            title="Content blur"
            description="Soften the screenshot inside the frame"
            enabled={Boolean(element.blur)}
            onAdd={() => patchDeviceFrame({ blur: 8 })}
            onRemove={() => patchDeviceFrame({ blur: null })}
          >
            {element.blur ? (
              <NumberField label="Blur radius" value={element.blur} min={0} max={MEDIA_BLUR_MAX} step={1} onChange={(blur) => patchDeviceFrame({ blur: blur === 0 ? null : blur })} />
            ) : null}
          </OptionalInspectorEffect>
          <InsetPanel>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-secondary)] ring-1 ring-[var(--editor-color-border)]">
                <Smartphone size={17} strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-[color:var(--editor-color-text-strong)]" title={element.assetUrl}>
                  {element.assetUrl?.split("/").at(-1) ?? "No screenshot assigned"}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--editor-color-text-muted)]">
                  {element.assetUrl ? "Project screenshot" : "The mockup shows a placeholder until you choose one."}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onChooseDeviceFrameAsset ? (
                <button
                  type="button"
                  className={`${editorUi.buttonSecondary} min-w-0 flex-1 !text-[13px]`}
                  onClick={onChooseDeviceFrameAsset}
                >
                  <ImagePlus size={14} strokeWidth={1.9} />
                  {element.assetUrl ? "Replace screenshot" : "Choose screenshot"}
                </button>
              ) : null}
              {element.assetUrl ? (
                <button
                  type="button"
                  className={editorUi.iconButtonDanger}
                  aria-label="Remove screenshot from device mockup"
                  title="Remove screenshot"
                  onClick={() => patchDeviceFrame({ assetUrl: null })}
                >
                  <Trash2 size={15} strokeWidth={1.9} />
                </button>
              ) : null}
            </div>
          </InsetPanel>
          <InsetPanel>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-secondary)] ring-1 ring-[var(--editor-color-border)]">
                <PanelsTopLeft size={17} strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-[color:var(--editor-color-text-strong)]">
                  {deviceFramePreset(element.deviceType).label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--editor-color-text-muted)]">
                  Built-in device frame preset
                </span>
              </span>
            </div>
            <button
              type="button"
              className={`${editorUi.buttonSecondary} w-full !text-[13px]`}
              onClick={() => setFramePickerOpen(true)}
            >
              <PanelsTopLeft size={14} strokeWidth={1.9} />
              Choose frame
            </button>
          </InsetPanel>
          {framePickerOpen ? (
            <DeviceFramePresetPicker
              selectedId={element.deviceType}
              screen={screen}
              onSelect={(deviceType) => patchDeviceFrame(deviceFrameSelectionPatch(element, deviceType))}
              onClose={() => setFramePickerOpen(false)}
            />
          ) : null}
        </Section>
      )}
    </>
  );
}
