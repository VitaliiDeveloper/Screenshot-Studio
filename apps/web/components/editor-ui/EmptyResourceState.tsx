// SPDX-License-Identifier: Apache-2.0
import { FolderOpen, type LucideIcon } from "lucide-react";

export function EmptyResourceState({
  title,
  description,
  path,
  icon: Icon = FolderOpen,
}: {
  title: string;
  description: string;
  path?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--editor-radius-surface)] border border-dashed border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-6 py-8 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-[var(--editor-radius-surface)] bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-secondary)] shadow-[var(--editor-shadow-control)] ring-1 ring-[var(--editor-color-border)]">
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <p className="text-sm font-medium text-[color:var(--editor-color-text-strong)]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">{description}</p>
      {path ? <code className="mt-3 rounded-[var(--editor-radius-compact)] bg-[var(--editor-color-surface-muted)] px-2 py-1 text-[11px] text-[color:var(--editor-color-text-muted)]">{path}</code> : null}
    </div>
  );
}
