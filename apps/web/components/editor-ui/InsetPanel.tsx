// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, editorUi } from "./styles.js";

export function InsetPanel({
  className,
  children,
  ...panelProps
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div {...panelProps} className={cx(editorUi.insetPanel, className)}>
      {children}
    </div>
  );
}
