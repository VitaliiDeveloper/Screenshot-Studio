// SPDX-License-Identifier: Apache-2.0
"use client";

import { cx } from "./styles.js";

/** A native colour input only holds `#rrggbb`, so `#RGB` and `#RRGGBBAA` are reduced for it. */
export function colorInputValue(color: string): string {
  const hex = color.slice(1).toLowerCase();
  return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex.slice(0, 6)}`;
}

/** Keeps the current alpha, except that fully transparent turns opaque: the pick would not show otherwise. */
export function pickedColor(picked: string, current: string): string {
  const alpha = current.length === 9 ? current.slice(7) : "";
  return alpha === "00" ? picked : `${picked}${alpha}`;
}

const CHECKERBOARD = "bg-[conic-gradient(var(--editor-color-border-strong)_25%,var(--editor-color-surface)_0_50%,var(--editor-color-border-strong)_0_75%,var(--editor-color-surface)_0)] bg-[length:8px_8px]";

/** The swatch paints the real value, alpha included, over a checkerboard; the native input stays on top to pick. */
export function ColorInput({
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (color: string) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <span className={cx("relative inline-block shrink-0 overflow-hidden", CHECKERBOARD, className)}>
      <span aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: value }} />
      <input
        type="color"
        aria-label={ariaLabel}
        value={colorInputValue(value)}
        onChange={(event) => onChange(pickedColor(event.currentTarget.value, value))}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}
