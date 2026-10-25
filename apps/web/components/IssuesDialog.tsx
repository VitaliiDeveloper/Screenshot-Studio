// SPDX-License-Identifier: Apache-2.0
"use client";

import { useStore } from "zustand";
import { fitTextSize } from "@screenshot-studio/core/engine";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { Project } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { cx, DialogShell, editorUi } from "@web/components/editor-ui";
import { editorStore } from "@web/lib/editor/editor-store";
import { countIssues, issueRowCopy, issueSummary, overflowTarget } from "@web/lib/editor/editor-issues";
import { applyTextFit } from "@web/lib/editor/editor-text-fit";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";

function overflowFitSize(project: Project, issue: ProjectIssue): number | null | undefined {
  if (issue.kind !== "text-overflow") return undefined;
  const target = overflowTarget(project, issue);
  return target ? fitTextSize(target.element, target.screen.direction) : null;
}

/** The Issues list (Handoff 6h): every issue offers Go to and its Fix. */
export function IssuesDialog({
  issues,
  specs,
  onGoTo,
  onReplaceImage,
  onClose,
}: {
  issues: readonly ProjectIssue[];
  specs: StoreSpecs;
  onGoTo: (issue: ProjectIssue) => void;
  /** Replace opens an asset picker, so the workspace owns it and closes Issues first. */
  onReplaceImage: (issue: Extract<ProjectIssue, { kind: "missing-image" }>) => void;
  onClose: () => void;
}) {
  const applyFix = (issue: ProjectIssue, fitSize: number | null | undefined) => {
    if (issue.kind === "missing-locale-screen") {
      mutateAndSave(() => editorStore.getState().createScreenFromLocale(issue.sourceScreenId, issue.locale));
    } else if (issue.kind === "missing-image") {
      onReplaceImage(issue);
    } else if (fitSize) {
      applyTextFit(issue.screenId, issue.elementId, fitSize);
    }
  };
  const project = useStore(editorStore, (state) => state.project);
  if (!project) return null;

  return (
    <DialogShell
      title="Issues"
      description={issueSummary(countIssues(issues))}
      initialFocus="heading"
      focusResetKey={issues.length}
      density="compact"
      widthClass="max-w-lg"
      bodyClassName="!p-0"
      onClose={onClose}
    >
      {issues.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-[color:var(--editor-color-text-secondary)]">
          Nothing to fix in this layout.
        </p>
      ) : (
        <ul aria-label="Issues" className="divide-y divide-[var(--editor-color-surface-muted)]">
          {issues.map((issue) => {
            const copy = issueRowCopy(project, issue, specs);
            if (!copy) return null;
            const blocker = issue.level === "blocker";
            const fitSize = overflowFitSize(project, issue);
            const fixUnavailable = fitSize === null;
            return (
              <li key={issue.id} className="flex gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className={cx(
                    "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold",
                    blocker
                      ? "bg-[var(--editor-color-danger-surface)] text-[color:var(--editor-color-danger-text)]"
                      : "bg-[var(--editor-color-warning-surface)] text-[color:var(--editor-color-warning-text)]",
                  )}
                >
                  {blocker ? "✕" : "!"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[color:var(--editor-color-text-strong)]">
                    <span className="sr-only">{blocker ? "Blocker: " : "Warning: "}</span>
                    {copy.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-[1.45] text-[color:var(--editor-color-text-secondary)]">
                    {copy.detail}
                  </p>
                  {fixUnavailable ? (
                    <p className="mt-1 text-xs text-[color:var(--editor-color-warning-text)]">
                      The text overflows even at 1 px. Resize the layer instead.
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    type="button"
                    aria-label={`Go to ${copy.detail}`}
                    className={cx(editorUi.buttonSecondary, "!min-h-7 whitespace-nowrap !text-xs")}
                    onClick={() => onGoTo(issue)}
                  >
                    Go to
                  </button>
                  <button
                    type="button"
                    aria-label={`${copy.fixLabel}: ${copy.detail}`}
                    disabled={fixUnavailable}
                    className={cx(editorUi.buttonPrimary, "!min-h-7 whitespace-nowrap !text-xs")}
                    onClick={() => applyFix(issue, fitSize)}
                  >
                    {copy.fixLabel}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-[var(--editor-color-surface-muted)] bg-[var(--editor-color-surface-subtle)] px-4 py-2.5 text-[11px] leading-[1.45] text-[color:var(--editor-color-text-secondary)]">
        Fit text sets the largest size that fits, on this screen only.
      </p>
    </DialogShell>
  );
}
