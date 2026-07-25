// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import { editorUi } from "@web/components/editor-ui";

export function InspectorSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-[var(--editor-color-border)] px-4 py-4">
      {title ? (
        <h3 className={editorUi.sectionLabel}>{title}</h3>
      ) : null}
      {children}
    </section>
  );
}
