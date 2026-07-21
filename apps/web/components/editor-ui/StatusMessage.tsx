// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, editorUi } from "@web/components/editor-ui/styles.js";

export function StatusMessage({
  tone,
  role = tone === "error" ? "alert" : "status",
  className,
  children,
  ...messageProps
}: Omit<HTMLAttributes<HTMLParagraphElement>, "role"> & {
  tone: "error" | "warning";
  role?: "alert" | "status";
  children?: ReactNode;
}) {
  return (
    <p
      {...messageProps}
      role={role}
      className={cx(
        tone === "error" ? editorUi.statusError : editorUi.statusWarning,
        className,
      )}
    >
      {children}
    </p>
  );
}
