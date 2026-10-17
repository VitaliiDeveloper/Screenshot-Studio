// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, editorUi } from "./styles.js";

export function ToolButton({
  label,
  active,
  variant,
  className,
  children,
  ...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed" | "type"> & {
  label: string;
  /** Omit for actions that open a dialog: they are not toggles, so they carry no pressed state. */
  active?: boolean;
  variant: "tool" | "panel";
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
        active
          ? variant === "tool"
            ? editorUi.toolButtonToolActive
            : editorUi.toolButtonPanelActive
          : editorUi.toolButtonInactive,
        className,
      )}
    >
      {children}
    </button>
  );
}
