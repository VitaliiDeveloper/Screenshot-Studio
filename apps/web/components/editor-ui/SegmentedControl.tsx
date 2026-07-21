// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import type { ReactNode } from "react";
import { cx, editorUi } from "@web/components/editor-ui/styles.js";

export type SegmentedControlOption<Value extends string> = Readonly<{
  value: Value;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}>;

export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  fill = false,
  className,
  onChange,
}: {
  label: string;
  value: Value | undefined;
  options: readonly SegmentedControlOption<Value>[];
  fill?: boolean;
  className?: string;
  onChange: (value: Value) => void;
}) {
  return (
    <span
      role="group"
      aria-label={label}
      className={cx(editorUi.segmentedControl, fill && editorUi.segmentedControlFill, className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={active}
            disabled={option.disabled}
            className={cx(
              editorUi.segmentedButton,
              fill && editorUi.segmentedButtonFill,
              active ? editorUi.segmentedButtonActive : editorUi.segmentedButtonInactive,
            )}
            onClick={() => onChange(option.value)}
          >
            <span className={editorUi.segmentedButtonLabel}>{option.label}</span>
          </button>
        );
      })}
    </span>
  );
}
