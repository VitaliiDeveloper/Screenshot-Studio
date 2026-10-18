// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, editorUi } from "./styles.js";

/** A tool-rail item: icon over a short visible caption that the accessible `label` contains. */
export function ToolButton({
  label,
  caption,
  active,
  className,
  children,
  ...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed" | "type"> & {
  label: string;
  caption?: string;
  /** Omit for actions that open a dialog: they are not toggles, so they carry no pressed state. */
  active?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      {...buttonProps}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cx(
        editorUi.toolButton,
        active ? editorUi.toolButtonActive : editorUi.toolButtonInactive,
        className,
      )}
    >
      {children}
      {caption ? <span>{caption}</span> : null}
    </button>
  );
}
