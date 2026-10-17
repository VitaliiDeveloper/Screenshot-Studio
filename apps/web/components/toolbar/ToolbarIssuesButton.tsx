// SPDX-License-Identifier: Apache-2.0
"use client";

import { CircleAlert } from "lucide-react";
import { issueSummary, type IssueCounts } from "@web/lib/editor-issues";
import { cx, editorUi } from "@web/components/editor-ui";

/** Accessible Issues summary shared by the toolbar button and its overflow-menu item. */
export function toolbarIssuesLabel(issueCounts: IssueCounts): string {
  return issueCounts.blockers + issueCounts.warnings > 0
    ? `Issues: ${issueSummary(issueCounts)}`
    : "Issues: none";
}

/** Opens the Issues dialog; tinted by the most severe open level. */
export function ToolbarIssuesButton({
  issueCounts,
  compact,
  labelClassName,
  onOpen,
}: {
  issueCounts: IssueCounts;
  compact: boolean;
  labelClassName: string;
  onOpen: () => void;
}) {
  const issueTotal = issueCounts.blockers + issueCounts.warnings;
  const issuesLabel = toolbarIssuesLabel(issueCounts);
  return (
    <button
      type="button"
      aria-label={issuesLabel}
      title={issuesLabel}
      className={cx(
        editorUi.buttonGhost,
        compact && "!gap-0",
        issueCounts.blockers > 0
          ? "!bg-[var(--editor-color-danger-surface)] !text-[color:var(--editor-color-danger-text)] hover:brightness-95"
          : issueCounts.warnings > 0
            ? "!bg-[var(--editor-color-warning-surface)] !text-[color:var(--editor-color-warning-text)] hover:brightness-95"
            : undefined,
      )}
      onClick={onOpen}
    >
      <CircleAlert size={15} strokeWidth={1.9} /> <span data-toolbar-label className={labelClassName}>Issues</span>
      {issueTotal > 0 ? (
        <span
          aria-hidden="true"
          className={cx("text-[11px] font-semibold tabular-nums", compact && "ml-1.5")}
        >{issueTotal}</span>
      ) : null}
    </button>
  );
}
