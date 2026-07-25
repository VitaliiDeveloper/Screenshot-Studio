// SPDX-License-Identifier: Apache-2.0
"use client";

import * as React from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
} from "lucide-react";
import {
  THEME_ROLES,
  type FontAsset,
  type TextElement,
  type ThemeRole,
} from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "@web/lib/editor-store";
import {
  cx,
  editorUi,
  MenuSelect,
  SegmentedControl,
} from "@web/components/editor-ui";
import {
  ColorField,
  FontIdentityField,
  NumberField,
  TextField,
} from "@web/components/inspector-fields";
import { OptionalInspectorEffect } from "./OptionalInspectorEffect";
import { InspectorDisclosure } from "./InspectorDisclosure";

const horizontalAlignOptions = [
  {
    value: "left",
    label: <AlignLeft size={14} strokeWidth={1.9} aria-hidden="true" />,
    ariaLabel: "Align text left",
  },
  {
    value: "center",
    label: <AlignCenter size={14} strokeWidth={1.9} aria-hidden="true" />,
    ariaLabel: "Align text center",
  },
  {
    value: "right",
    label: <AlignRight size={14} strokeWidth={1.9} aria-hidden="true" />,
    ariaLabel: "Align text right",
  },
] as const;

const verticalAlignOptions = [
  {
    value: "top",
    label: <AlignVerticalJustifyStart size={14} strokeWidth={1.9} aria-hidden="true" />,
    ariaLabel: "Align text to top",
  },
  {
    value: "middle",
    label: <AlignVerticalJustifyCenter size={14} strokeWidth={1.9} aria-hidden="true" />,
    ariaLabel: "Align text to middle",
  },
  {
    value: "bottom",
    label: <AlignVerticalJustifyEnd size={14} strokeWidth={1.9} aria-hidden="true" />,
    ariaLabel: "Align text to bottom",
  },
] as const;

export function TextInspectorFields({
  element,
  fonts,
  onChange,
}: {
  element: TextElement;
  fonts: FontAsset[];
  onChange: (change: ElementPatchFor<"text">) => void;
}) {
  return (
    <>
      <TextField
        label="Content"
        value={element.content}
        multiline
        onChange={(content) => onChange({ content })}
      />

      <div className="flex flex-col gap-2.5 border-t border-[var(--editor-color-border)] pt-3">
        <span className={editorUi.sectionLabel}>Style</span>
        <FontIdentityField
          fonts={fonts}
          family={element.fontFamily}
          weight={element.weight}
          onChange={({ family, weight }) => onChange({ fontFamily: family, weight })}
        />
        <NumberField
          label="Size"
          value={element.size}
          min={1}
          suffix="px"
          onChange={(size) => onChange({ size })}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="shrink-0 whitespace-nowrap text-[color:var(--editor-color-text-secondary)]">
            Horizontal align
          </span>
          <span className="w-36 shrink-0">
            <SegmentedControl
              label="Horizontal align"
              value={element.align}
              options={horizontalAlignOptions}
              fill
              compact
              onChange={(align) => onChange({ align })}
            />
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="shrink-0 whitespace-nowrap text-[color:var(--editor-color-text-secondary)]">
            Color
          </span>
          <label className={cx(
            editorUi.field,
            "flex w-36 cursor-pointer items-center gap-2 px-2",
          )}>
            <input
              type="color"
              aria-label="Text color"
              value={element.color}
              onChange={(event) => onChange({ color: event.currentTarget.value })}
              className="size-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="truncate font-medium tabular-nums text-[color:var(--editor-color-text-default)]">
              {element.color.toUpperCase()}
            </span>
          </label>
        </div>
      </div>

      <InspectorDisclosure
        label="Advanced typography"
        contentId="advanced-typography"
        surface
      >
        <NumberField
          label="Line height"
          value={element.lineHeight}
          min={0.1}
          step={0.1}
          suffix="×"
          onChange={(lineHeight) => onChange({ lineHeight })}
        />
        <NumberField
          label="Letter spacing"
          value={element.letterSpacing}
          suffix="px"
          onChange={(letterSpacing) => onChange({ letterSpacing })}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="shrink-0 whitespace-nowrap text-[color:var(--editor-color-text-secondary)]">
            Vertical align
          </span>
          <span className="w-36 shrink-0">
            <SegmentedControl
              label="Vertical align"
              value={element.verticalAlign ?? "top"}
              options={verticalAlignOptions}
              fill
              compact
              onChange={(verticalAlign) => onChange({ verticalAlign })}
            />
          </span>
        </div>
      </InspectorDisclosure>

      <OptionalInspectorEffect
        title="Shadow"
        description="Add depth behind the text"
        enabled={Boolean(element.shadow)}
        onAdd={() => onChange({
          shadow: { color: "#000000", blur: 12, offsetX: 0, offsetY: 6, opacity: 0.35 },
        })}
        onRemove={() => onChange({ shadow: null })}
      >
        {element.shadow ? (
          <>
            <ColorField
              label="Shadow color"
              value={element.shadow.color}
              onChange={(color) => onChange({ shadow: { ...element.shadow!, color } })}
            />
            <NumberField
              label="Shadow blur"
              value={element.shadow.blur}
              min={0}
              max={100}
              onChange={(blur) => onChange({ shadow: { ...element.shadow!, blur } })}
            />
            <NumberField
              label="Shadow X"
              value={element.shadow.offsetX}
              onChange={(offsetX) => onChange({ shadow: { ...element.shadow!, offsetX } })}
            />
            <NumberField
              label="Shadow Y"
              value={element.shadow.offsetY}
              onChange={(offsetY) => onChange({ shadow: { ...element.shadow!, offsetY } })}
            />
            <NumberField
              label="Shadow opacity"
              value={element.shadow.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(opacity) => onChange({ shadow: { ...element.shadow!, opacity } })}
            />
          </>
        ) : null}
      </OptionalInspectorEffect>

      <div className="flex items-start justify-between gap-3 border-t border-[var(--editor-color-border)] pt-3">
        <span className="min-w-0">
          <span className="block text-[length:var(--editor-font-control-size)] font-medium text-[color:var(--editor-color-text-default)]">
            Theme integration
          </span>
          <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--editor-color-text-secondary)]">
            Applied on the next theme change. Current styling stays unchanged.
          </span>
        </span>
        <MenuSelect
          ariaLabel="Theme role"
          value={element.role ?? ""}
          options={[
            { value: "", label: "None" },
            ...THEME_ROLES.map((role) => ({
              value: role,
              label: role.charAt(0).toUpperCase() + role.slice(1),
            })),
          ]}
          onChange={(nextValue) => onChange({
            role: (nextValue || null) as ThemeRole | null,
          })}
          className="w-28 shrink-0"
          fontSize={13}
        />
      </div>
    </>
  );
}
