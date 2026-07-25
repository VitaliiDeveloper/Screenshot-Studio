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
  onChange,
  onInteractionEnd,
}: {
  element: Element;
  artboard: Screen["artboard"];
  onChange: (patch: CommonElementPatch) => void;
  onInteractionEnd: () => void;
}) {
  const forcedLock = aspectRatioLockForced(element.type);
  const [ratioLocked, setRatioLocked] = useState(() => defaultAspectRatioLocked(element.type));

  const updatePosition = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const patch = directTransformPatch(element.locked, positionFromMiniPointer({
      pointer: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      preview: { width: bounds.width, height: bounds.height },
      artboard,
      element,
    }));
    if (patch) onChange(patch);
  };
  const handlePositionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keyPatch = positionKeyPatch(element, event.key, event.shiftKey);
    const patch = keyPatch ? directTransformPatch(element.locked, keyPatch) : null;
    if (!patch) return;
    event.preventDefault();
    onChange(patch);
  };
  const updateRotation = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const patch = directTransformPatch(element.locked, {
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
      const patch = directTransformPatch(element.locked, { rotation: element.rotation - delta });
      if (patch) onChange(patch);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const patch = directTransformPatch(element.locked, { rotation: element.rotation + delta });
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
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
        <button
          type="button"
          aria-label="Element position preview"
          disabled={element.locked}
          title={element.locked ? "Unlock the element to reposition it directly" : "Drag to reposition the element"}
          className="relative min-h-24 overflow-hidden rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ aspectRatio: `${artboard.width} / ${artboard.height}` }}
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
          <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--editor-color-border-strong)]" />
          <span className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-[var(--editor-color-border-strong)]" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute min-h-2 min-w-2 border-2 border-[var(--editor-color-accent)] bg-[var(--editor-color-accent-subtle)]"
            style={miniRect}
          >
            <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--editor-color-accent)] ring-2 ring-white" />
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

      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-end gap-3 border-t border-[var(--editor-color-border)] pt-3">
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-end gap-2">
          <button
            type="button"
            aria-label="Rotation dial"
            disabled={element.locked}
            title={element.locked ? "Unlock the element to rotate it directly" : "Drag to rotate the element"}
            className="relative size-14 rounded-full border-2 border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
            <span
              className="absolute left-1/2 top-1/2 h-[42%] w-0.5 origin-bottom -translate-x-1/2 -translate-y-full rounded-full bg-[var(--editor-color-accent)]"
              style={{ transform: `translate(-50%, -100%) rotate(${element.rotation}deg)` }}
            />
            <span className="absolute inset-0 grid place-items-center text-[10px] tabular-nums text-[color:var(--editor-color-text-default)]">
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
        <div onPointerUp={onInteractionEnd} onBlur={onInteractionEnd}>
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
