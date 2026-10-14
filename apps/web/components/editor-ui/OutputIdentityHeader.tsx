// SPDX-License-Identifier: Apache-2.0

import { cx } from "./styles.js";

export type OutputIdentityRole = "master" | "variant";

/** Shared overview identity: output family, editing state, exact target, and target role. */
export function OutputIdentityHeader({
  label,
  editing,
  sizeLabel,
  role,
  constrained = true,
}: {
  label: string;
  editing: boolean;
  sizeLabel?: string;
  role?: OutputIdentityRole;
  constrained?: boolean;
}) {
  return (
    <header
      data-testid="output-identity-header"
      data-output-role={role}
      className="mb-3 flex min-w-0 flex-col gap-1.5 text-[length:var(--editor-font-label-size)] font-semibold uppercase tracking-[var(--editor-font-label-tracking)] text-[color:var(--editor-color-text-secondary)]"
    >
      <div
        data-testid="output-identity-title-row"
        className="flex min-h-[1.125rem] min-w-0 items-center gap-2 overflow-hidden"
      >
        <span className={constrained ? "min-w-0 truncate" : undefined}>{label}</span>
        {editing ? (
          <span className="shrink-0 rounded-full bg-[var(--editor-color-accent-subtle)] px-2 py-0.5 text-[9px] tracking-normal text-[color:var(--editor-color-accent-hover)]">
            Editing
          </span>
        ) : null}
        <span
          className={cx(
            "h-px flex-1 bg-[var(--editor-color-border)]",
            constrained ? "min-w-0" : "min-w-12",
          )}
          aria-hidden="true"
        />
      </div>
      {sizeLabel && role ? (
        <div data-testid="output-identity-meta-row" className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span
            data-testid="output-identity-size"
            className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-normal text-[color:var(--editor-color-text-muted)]"
          >
            {sizeLabel}
          </span>
          <span
            data-testid="output-identity-role"
            className="shrink-0 rounded bg-[var(--editor-color-surface-muted)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-normal text-[color:var(--editor-color-text-muted)]"
          >
            {role}
          </span>
        </div>
      ) : null}
    </header>
  );
}
