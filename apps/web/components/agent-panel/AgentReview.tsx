// SPDX-License-Identifier: Apache-2.0
"use client";

import { useStore } from "zustand";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { IssueCounts } from "@web/lib/editor/editor-issues";
import { editorStore } from "@web/lib/editor/editor-store";
import type { EditorAgentChat } from "@web/app/editor/use-editor-agent-chat";
import { cx, editorUi, StatusMessage } from "@web/components/editor-ui";
import { changedScreenRows, hasOtherFiles } from "@web/components/agent-panel-model";
import { agentButton, dot, hint } from "./agent-panel-styles";
import { OtherFilesView } from "./OtherFilesView";

/** Mockup 7b: what the run changed, the checks, and Keep / Undo run. */
export function AgentReview({
  chat,
  specs,
  issueCounts,
  onGoToScreen,
  onOpenIssues,
}: {
  chat: EditorAgentChat;
  specs: StoreSpecs;
  issueCounts: IssueCounts;
  onGoToScreen: (screenId: string) => void;
  onOpenIssues: () => void;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const { outcome } = chat;
  if (!outcome || !project) return null;
  const rows = changedScreenRows(project, outcome.changedScreens, specs);
  const lastTurn = chat.turns.at(-1);
  const summary = lastTurn?.done?.summary ?? lastTurn?.text.at(-1) ?? null;
  const finishedAt = new Date(outcome.finishedAt);
  const issueTotal = issueCounts.blockers + issueCounts.warnings;
  const busy = chat.phase !== "idle";
  return (
    <section aria-label="Agent run review" className="flex min-h-0 flex-1 flex-col">
      <div className="editor-scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 border-b border-[var(--editor-color-border)] px-3.5 py-3">
          <h3 className={editorUi.sectionLabel}>Review</h3>
          <p className="text-[12.5px] leading-normal">{summary ?? "The last agent run changed this project."}</p>
        </div>
        <div className="flex flex-col gap-1.5 border-b border-[var(--editor-color-border)] px-3.5 py-3">
          <div className="flex items-center">
            <h3 className={cx(editorUi.sectionLabel, "flex-1")}>Changes · {rows.length}</h3>
            <span className={hint}>
              Run <time dateTime={outcome.finishedAt}>{finishedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </span>
          </div>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 rounded-[var(--editor-radius-control)] px-2 py-1.5">
                <span aria-hidden="true" className={cx(dot, "bg-[var(--editor-color-agent)]")} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-xs font-medium">{row.name}</span>
                  {row.detail ? <span className={hint}>{row.detail}</span> : null}
                </span>
                {row.detail ? (
                  <button
                    type="button"
                    aria-label={`Go to ${row.name}`}
                    className={cx(editorUi.buttonGhostAccent, "!min-h-6 !px-1.5 text-[11px]")}
                    onClick={() => onGoToScreen(row.id)}
                  >
                    Go to
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {hasOtherFiles(outcome.otherFiles) ? (
          <div className="border-b border-[var(--editor-color-border)] px-3.5 py-3 text-xs">
            <OtherFilesView otherFiles={outcome.otherFiles} />
          </div>
        ) : null}
        <div className="flex flex-col gap-2 px-3.5 py-3 text-xs">
          <h3 className={editorUi.sectionLabel}>Checks</h3>
          <p className="flex items-center gap-2 text-[color:var(--editor-color-text-muted)]">
            <span aria-hidden="true" className={cx(dot, "bg-[var(--editor-color-success)]")} />
            Project passes schema validation
          </p>
          <p className={cx("flex items-center gap-2", issueTotal > 0 ? "text-[color:var(--editor-color-warning-text)]" : "text-[color:var(--editor-color-text-muted)]")}>
            <span aria-hidden="true" className={cx(dot, issueTotal > 0 ? "bg-[var(--editor-color-warning)]" : "bg-[var(--editor-color-success)]")} />
            <span className="flex-1">
              {issueTotal === 0
                ? "No issues"
                : [
                  issueCounts.blockers ? `${issueCounts.blockers} ${issueCounts.blockers === 1 ? "blocker" : "blockers"}` : null,
                  issueCounts.warnings ? `${issueCounts.warnings} ${issueCounts.warnings === 1 ? "warning" : "warnings"}` : null,
                ].filter(Boolean).join(" · ")}
            </span>
            {issueTotal > 0 ? (
              <button type="button" aria-haspopup="dialog" className={cx(editorUi.buttonSecondary, "!min-h-6 !px-2 text-[11px]")} onClick={onOpenIssues}>
                Issues
              </button>
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-3.5 py-3">
        {chat.outcomeError ? <StatusMessage tone="error">{chat.outcomeError}</StatusMessage> : null}
        <div className="flex gap-2">
          <button type="button" className={cx(editorUi.buttonSecondary, "flex-1")} disabled={busy} onClick={() => void chat.undo()}>
            {chat.phase === "syncing" ? "Undoing…" : "Undo run"}
          </button>
          <button
            type="button"
            data-agent-review-focus
            className={cx(agentButton, "flex-1")}
            disabled={busy}
            onClick={() => void chat.keep()}
          >
            Keep changes
          </button>
        </div>
        <p className={hint}>Undo run restores the project file from the snapshot taken before the run.</p>
      </div>
    </section>
  );
}
