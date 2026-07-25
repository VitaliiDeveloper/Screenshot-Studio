// SPDX-License-Identifier: Apache-2.0
"use client";

import NextImage from "next/image";
import { useState, type CSSProperties } from "react";
import { ChevronDown, Image as ImageIcon, Pipette } from "lucide-react";
import type { Background } from "@screenshot-studio/core/model";
import { resolveActiveProjectAssetUrl } from "@web/lib/save-project";
import { editorUi, MenuSelect, SegmentedControl } from "@web/components/editor-ui";
import { NumberField } from "@web/components/inspector-fields";

const GRADIENT_DIRECTIONS = [
  { value: "left-to-right", label: "Left → right", angle: 0 },
  { value: "top-left-to-bottom-right", label: "Top-left → bottom-right", angle: 45 },
  { value: "top-to-bottom", label: "Top → bottom", angle: 90 },
  { value: "top-right-to-bottom-left", label: "Top-right → bottom-left", angle: 135 },
  { value: "right-to-left", label: "Right → left", angle: 180 },
  { value: "bottom-right-to-top-left", label: "Bottom-right → top-left", angle: 225 },
  { value: "bottom-to-top", label: "Bottom → top", angle: 270 },
  { value: "bottom-left-to-top-right", label: "Bottom-left → top-right", angle: 315 },
] as const;

type GradientDirection = (typeof GRADIENT_DIRECTIONS)[number]["value"] | "custom";

const GRADIENT_DIRECTION_OPTIONS = [
  ...GRADIENT_DIRECTIONS.map(({ value, label }) => ({ value, label })),
  { value: "custom" as const, label: "Custom angle" },
];

function gradientDirection(angle: number): GradientDirection {
  const normalizedAngle = angle === 360 ? 0 : angle;
  return GRADIENT_DIRECTIONS.find((direction) => direction.angle === normalizedAngle)?.value
    ?? "custom";
}

function previewImageUrl(assetUrl: string): string {
  try {
    return resolveActiveProjectAssetUrl(assetUrl);
  } catch {
    return assetUrl;
  }
}

function gradientStyle(background: Extract<Background, { type: "linear-gradient" }>): CSSProperties {
  const cssAngle = (background.angle + 90) % 360;
  return {
    backgroundImage: `linear-gradient(${cssAngle}deg, ${background.from}, ${background.to})`,
  };
}

function BackgroundColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap text-[color:var(--editor-color-text-secondary)]">{label}</span>
      <span className="relative inline-flex h-8 w-36 min-w-0 items-center gap-2 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-2 shadow-[var(--editor-shadow-control)] transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] hover:border-[var(--editor-color-border-strong)] focus-within:border-[var(--editor-color-focus-border)] focus-within:ring-[length:var(--editor-focus-width)] focus-within:ring-[var(--editor-color-focus-subtle)]">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: value }}
        />
        <span className="min-w-0 flex-1 truncate text-right font-medium uppercase tabular-nums text-[color:var(--editor-color-text)]">
          {value}
        </span>
        <ChevronDown size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-[color:var(--editor-color-text-subtle)]" />
      </span>
    </label>
  );
}

export function BackgroundInspectorFields({
  background,
  onChange,
  onChooseImage,
}: {
  background: Background;
  onChange: (background: Background) => void;
  onChooseImage?: () => void;
}) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const imageUrl = background.type === "image" ? previewImageUrl(background.assetUrl) : null;
  const showImage = background.type === "image" && failedPreviewUrl !== background.assetUrl;
  const previewStyle: CSSProperties = background.type === "solid"
    ? { backgroundColor: background.color }
    : background.type === "linear-gradient"
      ? gradientStyle(background)
      : { backgroundColor: background.color };
  const summary = background.type === "solid"
    ? background.color
    : background.type === "linear-gradient"
      ? `${background.from} → ${background.to}`
      : background.assetUrl.split("/").at(-1) ?? "Project image";
  const quickColor = background.type === "solid"
    ? background.color
    : background.type === "linear-gradient"
      ? background.from
      : null;

  const changeType = (type: Background["type"]) => {
    const baseColor = background.type === "solid"
      ? background.color
      : background.type === "linear-gradient"
        ? background.from
        : background.color;
    if (type === "solid") onChange({ type, color: baseColor });
    else if (type === "linear-gradient") onChange({ type, from: baseColor, to: "#000000", angle: 0 });
    else if (background.type !== "image") onChooseImage?.();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div
        aria-label="Background preview"
        data-background-type={background.type}
        className="relative h-20 overflow-hidden rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-muted)] shadow-inner"
        style={previewStyle}
      >
        {background.type === "image" ? (
          showImage && imageUrl ? (
            <NextImage
              fill
              unoptimized
              src={imageUrl}
              alt=""
              aria-hidden="true"
              sizes="256px"
              className={background.fit === "cover" ? "object-cover" : "object-contain"}
              onError={() => setFailedPreviewUrl(background.assetUrl)}
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-white/75">
              <ImageIcon size={22} strokeWidth={1.7} aria-hidden="true" />
            </span>
          )
        ) : null}
      </div>

      <div className={`relative flex min-w-0 items-center gap-2 border-b border-[var(--editor-color-border)] pb-2.5 text-xs ${quickColor ? "cursor-pointer focus-within:ring-2 focus-within:ring-[var(--editor-color-focus)]" : ""}`}>
        {quickColor ? (
          <input
            type="color"
            aria-label="Quick background color"
            value={quickColor}
            onChange={(event) => {
              const color = event.currentTarget.value;
              if (background.type === "solid") onChange({ ...background, color });
              else if (background.type === "linear-gradient") onChange({ ...background, from: color });
            }}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          />
        ) : null}
        <span
          aria-hidden="true"
          className="size-7 shrink-0 rounded-[var(--editor-radius-control)] ring-1 ring-inset ring-black/10"
          style={previewStyle}
        />
        <span className="min-w-0 flex-1 truncate font-medium uppercase tabular-nums text-[color:var(--editor-color-text)]" title={summary}>
          {summary}
        </span>
        {background.type === "image" ? (
          <ImageIcon size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-[color:var(--editor-color-text-subtle)]" />
        ) : (
          <Pipette size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-[color:var(--editor-color-text-subtle)]" />
        )}
      </div>

      <SegmentedControl
        label="Background type"
        value={background.type}
        options={[
          { value: "solid", label: "Solid", ariaLabel: "Use Solid background" },
          { value: "linear-gradient", label: "Gradient", ariaLabel: "Use Gradient background" },
          { value: "image", label: "Image", ariaLabel: "Use Image background" },
        ]}
        fill
        className="min-w-0 [&_button]:min-w-0 [&_button]:px-2 [&_button[aria-pressed=true]]:text-[color:var(--editor-color-accent-hover)] [&_button[aria-pressed=true]]:ring-1 [&_button[aria-pressed=true]]:ring-inset [&_button[aria-pressed=true]]:ring-[var(--editor-color-accent)]"
        onChange={changeType}
      />

      {background.type === "solid" ? (
        <BackgroundColorField
          label="Color"
          value={background.color}
          onChange={(color) => onChange({ ...background, color })}
        />
      ) : background.type === "linear-gradient" ? (
        <>
          <BackgroundColorField
            label="From"
            value={background.from}
            onChange={(from) => onChange({ ...background, from })}
          />
          <BackgroundColorField
            label="To"
            value={background.to}
            onChange={(to) => onChange({ ...background, to })}
          />
          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="shrink-0 whitespace-nowrap text-[color:var(--editor-color-text-secondary)]">Direction</span>
            <MenuSelect
              ariaLabel="Gradient direction"
              value={gradientDirection(background.angle)}
              options={GRADIENT_DIRECTION_OPTIONS}
              onChange={(direction) => {
                const preset = GRADIENT_DIRECTIONS.find(({ value }) => value === direction);
                if (preset) onChange({ ...background, angle: preset.angle });
              }}
              className="w-40"
            />
          </label>
          <NumberField
            label="Angle"
            value={background.angle}
            min={0}
            max={360}
            integer
            suffix="°"
            onChange={(angle) => onChange({ ...background, angle })}
          />
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-2">
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[var(--editor-radius-compact)] bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-secondary)] ring-1 ring-[var(--editor-color-border)]">
              {showImage && imageUrl ? (
                <NextImage
                  width={32}
                  height={32}
                  unoptimized
                  src={imageUrl}
                  alt=""
                  aria-hidden="true"
                  className="size-8 object-cover"
                  onError={() => setFailedPreviewUrl(background.assetUrl)}
                />
              ) : (
                <ImageIcon size={16} strokeWidth={1.8} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[color:var(--editor-color-text)]" title={background.assetUrl}>
              {background.assetUrl.split("/").at(-1)}
            </span>
            <button type="button" className={`${editorUi.buttonSecondary} shrink-0 !h-7 !min-h-7 !px-2 !text-[11px]`} onClick={onChooseImage}>
              Replace background
            </button>
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="text-[color:var(--editor-color-text-secondary)]">Content mode</span>
            <SegmentedControl
              label="Background content mode"
              value={background.fit}
              options={[
                { value: "cover", label: "Fill", ariaLabel: "Fill background image" },
                { value: "contain", label: "Fit", ariaLabel: "Fit background image" },
              ]}
              fill
              onChange={(fit) => onChange({ ...background, fit })}
            />
          </div>
          <BackgroundColorField
            label="Fallback"
            value={background.color}
            onChange={(color) => onChange({ ...background, color })}
          />
        </>
      )}
    </div>
  );
}
