// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Lock, LockOpen } from "lucide-react";
import type { Element, Screen } from "@screenshot-studio/core/model";
import type { CommonElementPatch } from "@web/lib/editor-element-patch";
import { editorUi } from "@web/components/editor-ui";
import {
  NumberField,
  percentToUnit,
  SliderNumberField,
  unitToPercent,
} from "@web/components/inspector-fields";
import {
  aspectRatioLockForced,
  defaultAspectRatioLocked,
  directTransformPatch,
  linkedSizePatch,
  positionFromMiniPointer,
  rotationFromPointer,
} from "./transform-inspector-model";

const OPACITY_HELP = "Adjusts this layer’s transparency. Exported images are always flattened and contain no alpha channel.";

function positionKeyPatch(
  element: Pick<Element, "x" | "y">,
  key: string,
  largeStep: boolean,
): Pick<CommonElementPatch, "x" | "y"> | null {
  const step = largeStep ? 10 : 1;
  if (key === "ArrowLeft") return { x: element.x - step };
  if (key === "ArrowRight") return { x: element.x + step };
  if (key === "ArrowUp") return { y: element.y - step };
  if (key === "ArrowDown") return { y: element.y + step };
  return null;
}

export function TransformInspectorFields({
  element,
  artboard,
  effectiveLocked: effectiveLockedProp,
  onChange,
  onInteractionEnd,
}: {
  element: Element;
  artboard: Screen["artboard"];
  effectiveLocked?: boolean;
  onChange: (patch: CommonElementPatch) => void;
  onInteractionEnd: () => void;
}) {
  const forcedLock = aspectRatioLockForced(element.type);
  const effectiveLocked = effectiveLockedProp ?? element.locked;
  const [ratioLocked, setRatioLocked] = useState(() => defaultAspectRatioLocked(element.type));

  const updatePosition = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const patch = directTransformPatch(effectiveLocked, positionFromMiniPointer({
      pointer: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      preview: { width: bounds.width, height: bounds.height },
      artboard,
      element,
    }));
    if (patch) onChange(patch);
  };
  const handlePositionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keyPatch = positionKeyPatch(element, event.key, event.shiftKey);
    const patch = keyPatch ? directTransformPatch(effectiveLocked, keyPatch) : null;
    if (!patch) return;
    event.preventDefault();
    onChange(patch);
  };
  const updateRotation = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const patch = directTransformPatch(effectiveLocked, {
      rotation: rotationFromPointer(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        { x: bounds.width / 2, y: bounds.height / 2 },
      ),
    });
    if (patch) onChange(patch);
  };
  const handleRotationKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      const patch = directTransformPatch(effectiveLocked, { rotation: element.rotation - delta });
      if (patch) onChange(patch);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const patch = directTransformPatch(effectiveLocked, { rotation: element.rotation + delta });
      if (patch) onChange(patch);
    }
  };
  const miniRect = {
    left: `${(element.x / artboard.width) * 100}%`,
    top: `${(element.y / artboard.height) * 100}%`,
    width: `${(element.width / artboard.width) * 100}%`,
    height: `${(element.height / artboard.height) * 100}%`,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-5">
        <button
          type="button"
          aria-label="Element position preview"
          disabled={effectiveLocked}
          title={effectiveLocked ? "Unlock the element and its group to reposition it directly" : "Drag to reposition the element"}
          className="grid h-32 w-32 place-items-center overflow-hidden rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            updatePosition(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePosition(event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            onInteractionEnd();
          }}
          onPointerCancel={onInteractionEnd}
          onKeyDown={handlePositionKey}
          onBlur={onInteractionEnd}
        >
          <span
            className="pointer-events-none relative h-full w-auto max-w-full overflow-hidden rounded-[var(--editor-radius-compact)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)]"
            style={{ aspectRatio: `${artboard.width} / ${artboard.height}` }}
          >
            <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--editor-color-border-strong)]" />
            <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-[var(--editor-color-border-strong)]" />
            <span
              aria-hidden="true"
              className="absolute min-h-2 min-w-2 border-2 border-[var(--editor-color-accent)] bg-[var(--editor-color-accent-subtle)]"
              style={miniRect}
            >
              <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--editor-color-accent)] ring-2 ring-[var(--editor-color-on-media)]" />
            </span>
          </span>
        </button>
        <div className="flex flex-col justify-center gap-2">
          <NumberField label="X" value={element.x} precision={2} suffix="px" controlClassName="!w-full" onChange={(x) => onChange({ x })} />
          <NumberField label="Y" value={element.y} precision={2} suffix="px" controlClassName="!w-full" onChange={(y) => onChange({ y })} />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-end gap-2">
        <NumberField
          label="Width"
          value={element.width}
          min={1}
          precision={2}
          layout="column"
          suffix="px"
          onChange={(width) => onChange(linkedSizePatch(element, "width", width, ratioLocked || forcedLock))}
        />
        <button
          type="button"
          aria-label="Lock aspect ratio"
          aria-pressed={ratioLocked || forcedLock}
          disabled={forcedLock}
          title={forcedLock ? "Aspect ratio is fixed for this element" : "Lock aspect ratio"}
          className={ratioLocked || forcedLock ? editorUi.iconButtonActive : editorUi.iconButton}
          onClick={() => setRatioLocked((current) => !current)}
        >
          {ratioLocked || forcedLock ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
        </button>
        <NumberField
          label="Height"
          value={element.height}
          min={1}
          precision={2}
          layout="column"
          suffix="px"
          onChange={(height) => onChange(linkedSizePatch(element, "height", height, ratioLocked || forcedLock))}
        />
      </div>

      <div
        data-transform-secondary-controls="stacked"
        className="flex flex-col gap-3 border-t border-[var(--editor-color-border)] pt-3"
      >
        <div className="flex min-w-0 flex-col gap-1.5 text-xs">
          <span className="text-[color:var(--editor-color-text-secondary)]">Rotation</span>
          <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3">
            <button
              type="button"
              aria-label="Rotation dial"
              disabled={effectiveLocked}
              title={effectiveLocked ? "Unlock the element and its group to rotate it directly" : "Drag to rotate the element"}
              className="relative size-16 rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateRotation(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) updateRotation(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                onInteractionEnd();
              }}
              onPointerCancel={onInteractionEnd}
              onKeyDown={handleRotationKey}
              onBlur={onInteractionEnd}
            >
              <span className="pointer-events-none absolute inset-1 rotate-45 rounded-full border-[3px] border-[var(--editor-color-border)] border-b-transparent" />
              <span
                data-rotation-dial-arc="active"
                className="pointer-events-none absolute inset-1 -rotate-[28deg] rounded-full border-[3px] border-transparent border-l-[var(--editor-color-accent)] border-t-[var(--editor-color-accent)]"
              />
              <span
                data-rotation-dial-thumb=""
                className="pointer-events-none absolute inset-1"
                style={{ transform: `rotate(${element.rotation}deg)` }}
              >
                <span className="absolute left-1/2 top-0 size-3 -translate-x-1/2 -translate-y-0.5 rounded-full bg-[var(--editor-color-accent)] ring-2 ring-[var(--editor-color-on-media)]" />
              </span>
              <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs tabular-nums text-[color:var(--editor-color-text-default)]">
                {Math.round(element.rotation)}°
              </span>
            </button>
            <NumberField
              label="Rotation"
              labelHidden
              value={element.rotation}
              precision={2}
              suffix="°"
              controlClassName="!w-full"
              onChange={(rotation) => onChange({ rotation })}
            />
          </div>
        </div>
        <div className="min-w-0" onPointerUp={onInteractionEnd} onBlur={onInteractionEnd}>
          <SliderNumberField
            label="Opacity"
            value={unitToPercent(element.opacity)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            helpText={OPACITY_HELP}
            onChange={(opacity) => onChange({ opacity: percentToUnit(opacity) })}
          />
        </div>
      </div>
    </div>
  );
}
