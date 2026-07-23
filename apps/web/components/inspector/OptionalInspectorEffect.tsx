// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { editorUi, InsetPanel } from "@web/components/editor-ui";

export function OptionalInspectorEffect({
  title,
  description,
  enabled,
  onAdd,
  onRemove,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const normalizedTitle = title.toLocaleLowerCase("en");

  if (!enabled) {
    return (
      <div className="flex min-h-12 items-center justify-between gap-3 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-[var(--editor-space-inset)] py-2">
        <span className="min-w-0">
          <span className="block text-[length:var(--editor-font-control-size)] font-medium text-[color:var(--editor-color-text-default)]">
            {title}
          </span>
          <span className="block truncate text-[10px] text-[color:var(--editor-color-text-secondary)]">
            {description}
          </span>
        </span>
        <button
          type="button"
          aria-label={`Add ${normalizedTitle}`}
          title={`Add ${normalizedTitle}`}
          className={editorUi.compactAddButton}
          onClick={onAdd}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <InsetPanel>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-[length:var(--editor-font-control-size)] font-medium text-[color:var(--editor-color-text-default)]">
          {title}
        </span>
        <button
          type="button"
          aria-label={`Remove ${normalizedTitle}`}
          title={`Remove ${normalizedTitle}`}
          className={editorUi.compactIconButton}
          onClick={onRemove}
        >
          <X size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
      {children}
    </InsetPanel>
  );
}
