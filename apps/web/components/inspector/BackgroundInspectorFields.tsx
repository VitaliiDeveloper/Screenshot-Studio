// SPDX-License-Identifier: Apache-2.0
"use client";

import NextImage from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowLeftRight, ChevronDown, Image as ImageIcon, RotateCcw } from "lucide-react";
import type { Background } from "@screenshot-studio/core/model";
import { resolveActiveProjectAssetUrl } from "@web/lib/clients/save-project";
import { editorUi, SegmentedControl } from "@web/components/editor-ui";
import { NumberField } from "@web/components/inspector/inspector-fields";

const GRADIENT_DIRECTION_AXES = [
  {
    angle: 0,
    forward: { symbol: "→", label: "Left to right" },
    reverse: { symbol: "←", label: "Right to left" },
  },
  {
    angle: 45,
    forward: { symbol: "↘", label: "Top-left to bottom-right" },
    reverse: { symbol: "↖", label: "Bottom-right to top-left" },
  },
  {
    angle: 90,
    forward: { symbol: "↓", label: "Top to bottom" },
    reverse: { symbol: "↑", label: "Bottom to top" },
  },
  {
    angle: 135,
    forward: { symbol: "↙", label: "Top-right to bottom-left" },
    reverse: { symbol: "↗", label: "Bottom-left to top-right" },
  },
] as const;

function normalizeGradientAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function previewImageUrl(assetUrl: string): string {
  try {
    return resolveActiveProjectAssetUrl(assetUrl);
  } catch {
    return assetUrl;
  }
}

export function gradientStyle(background: Extract<Background, { type: "linear-gradient" }>): CSSProperties {
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
          className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-[var(--editor-color-swatch-outline)]"
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

function CompactBackgroundColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs">
      <span className="text-[color:var(--editor-color-text-secondary)]">{label}</span>
      <span className="relative inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-2 shadow-[var(--editor-shadow-control)] transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] hover:border-[var(--editor-color-border-strong)] focus-within:border-[var(--editor-color-focus-border)] focus-within:ring-[length:var(--editor-focus-width)] focus-within:ring-[var(--editor-color-focus-subtle)]">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-[var(--editor-color-swatch-outline)]"
          style={{ backgroundColor: value }}
        />
        <span className="min-w-0 flex-1 truncate text-right text-[10px] font-medium uppercase tabular-nums text-[color:var(--editor-color-text)]">
          {value}
        </span>
      </span>
    </label>
  );
}

function AnimatedInspectorContent({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => setHeight(content.getBoundingClientRect().height);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-testid="background-context-controls"
      className="overflow-hidden transition-[height] duration-200 ease-[var(--editor-motion-ease)] motion-reduce:transition-none"
      style={height === undefined ? undefined : { height }}
    >
      <div ref={contentRef} className="flex flex-col gap-2.5">
        {children}
      </div>
    </div>
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
  const normalizedGradientAngle = background.type === "linear-gradient"
    ? normalizeGradientAngle(background.angle)
    : 0;
  const gradientDirectionReversed = normalizedGradientAngle >= 180;

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
        role="img"
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
            <span className="absolute inset-0 grid place-items-center text-[color:var(--editor-color-on-media-muted)]">
              <ImageIcon size={22} strokeWidth={1.7} aria-hidden="true" />
            </span>
          )
        ) : null}
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
        onChange={changeType}
      />

      <AnimatedInspectorContent>
        {background.type === "solid" ? (
          <BackgroundColorField
            label="Color"
            value={background.color}
            onChange={(color) => onChange({ ...background, color })}
          />
        ) : background.type === "linear-gradient" ? (
          <>
            <div role="group" aria-label="Gradient colors" className="grid grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-end gap-1.5">
              <CompactBackgroundColorField
                label="From"
                value={background.from}
                onChange={(from) => onChange({ ...background, from })}
              />
              <button
                type="button"
                aria-label="Swap gradient colors"
                title="Swap gradient colors"
                className={`${editorUi.compactIconButton} mb-1`}
                onClick={() => onChange({ ...background, from: background.to, to: background.from })}
              >
                <ArrowLeftRight size={14} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <CompactBackgroundColorField
                label="To"
                value={background.to}
                onChange={(to) => onChange({ ...background, to })}
              />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-end gap-2">
              <div className="flex min-w-0 flex-col gap-1.5 text-xs">
                <span className="text-[color:var(--editor-color-text-secondary)]">Direction</span>
                <div
                  role="group"
                  aria-label="Gradient direction presets"
                  className="flex h-8 min-w-0 items-center gap-0.5 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-muted)] p-1"
                >
                  {GRADIENT_DIRECTION_AXES.map((axis) => {
                    const direction = gradientDirectionReversed ? axis.reverse : axis.forward;
                    const selected = normalizedGradientAngle % 180 === axis.angle;
                    return (
                      <button
                        key={axis.angle}
                        type="button"
                        aria-label={`Set gradient direction to ${direction.label}`}
                        title={direction.label}
                        aria-pressed={selected}
                        className={`flex h-6 min-w-0 flex-1 items-center justify-center rounded-[var(--editor-radius-compact)] text-sm leading-none transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)] ${selected
                          ? "bg-[var(--editor-color-surface)] font-semibold text-[color:var(--editor-color-accent-hover)] shadow-[var(--editor-shadow-control)]"
                          : "text-[color:var(--editor-color-text-secondary)] hover:bg-[var(--editor-color-surface-translucent)] hover:text-[color:var(--editor-color-text)]"
                        }`}
                        onClick={() => onChange({
                          ...background,
                          angle: axis.angle + (gradientDirectionReversed ? 180 : 0),
                        })}
                      >
                        <span aria-hidden="true">{direction.symbol}</span>
                      </button>
                    );
                  })}
                  <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-[var(--editor-color-border)]" />
                  <button
                    type="button"
                    aria-label="Reverse gradient direction"
                    title="Reverse direction"
                    aria-pressed={gradientDirectionReversed}
                    className={`flex size-6 shrink-0 items-center justify-center rounded-[var(--editor-radius-compact)] transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)] ${gradientDirectionReversed
                      ? "bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-hover)]"
                      : "text-[color:var(--editor-color-text-subtle)] hover:bg-[var(--editor-color-surface-translucent)] hover:text-[color:var(--editor-color-text)]"
                    }`}
                    onClick={() => onChange({
                      ...background,
                      angle: (normalizedGradientAngle + 180) % 360,
                    })}
                  >
                    <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <NumberField
                label="Angle"
                layout="column"
                controlClassName="!w-full"
                value={background.angle}
                min={0}
                max={360}
                integer
                suffix="°"
                onChange={(angle) => onChange({ ...background, angle })}
              />
            </div>
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
      </AnimatedInspectorContent>
    </div>
  );
}
