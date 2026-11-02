// SPDX-License-Identifier: Apache-2.0
"use client";

import { Check, Circle, CircleDot } from "lucide-react";
import { attachmentThumbnail } from "@web/components/ComposerAttachments";
import { cx, editorUi, StatusMessage } from "@web/components/editor-ui";
import {
  hasOtherFiles,
  turnActivity,
  turnOutcome,
  turnProgressLabel,
  type AgentTurn,
} from "@web/components/agent-panel-model";
import { agentBox, dot, hint } from "./agent-panel-styles";
import { OtherFilesView } from "./OtherFilesView";

function StepIcon({ status }: { status: AgentTurn["steps"][number]["status"] }) {
  if (status === "completed") return <Check aria-hidden="true" size={12} className="shrink-0 text-[color:var(--editor-color-success)]" />;
  if (status === "in_progress") return <CircleDot aria-hidden="true" size={12} className="shrink-0 text-[color:var(--editor-color-agent-text)]" />;
  return <Circle aria-hidden="true" size={12} className="shrink-0 text-[color:var(--editor-color-text-faint)]" />;
}

const STEP_STATUS = { completed: "done", in_progress: "in progress", pending: "to do" } as const;

function TurnOutcomeView({
  turn,
  onRetry,
  onSwitchAgent,
  onAskToFix,
  onApplyFindings,
}: {
  turn: AgentTurn;
  onRetry: () => void;
  onSwitchAgent: () => void;
  onAskToFix: (reason: string) => void;
  onApplyFindings: () => void;
}) {
  const outcome = turnOutcome(turn);
  if (!outcome) return null;
  // Images do not survive a reload, so resending such a turn would drop them.
  const actions = turn.droppedImages === 0;
  // Undo and the rollback restore only the project file; say so when other files changed too.
  const project = turn.result && hasOtherFiles(turn.result.otherFiles) ? "project file" : "project";
  switch (outcome.kind) {
    case "limit":
      return (
        <div className="flex flex-col gap-2">
          <StatusMessage tone="warning" role="alert">
            Your {turn.agentName} subscription limit {outcome.resets ? `resets ${outcome.resets}` : "is reached"}.
            {outcome.unchanged ? ` Nothing in the ${project} was changed.` : ""}
          </StatusMessage>
          {actions ? (
            <div className="flex gap-2">
              <button type="button" className={editorUi.buttonSecondary} onClick={onSwitchAgent}>Switch agent</button>
              <button type="button" className={editorUi.buttonSecondary} onClick={onRetry}>Retry</button>
            </div>
          ) : null}
        </div>
      );
    case "rejected":
      return (
        <div className="flex flex-col gap-2">
          <StatusMessage tone="error">
            The agent&apos;s changes didn&apos;t pass schema validation. The {project} is back to its state before the run.
          </StatusMessage>
          <details className="text-xs text-[color:var(--editor-color-text-muted)]">
            <summary className="cursor-pointer select-none">Show details</summary>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">{outcome.reason}</p>
          </details>
          {actions ? (
            <button type="button" className={cx(editorUi.buttonSecondary, "self-start")} onClick={() => onAskToFix(outcome.reason)}>
              Ask agent to fix
            </button>
          ) : null}
        </div>
      );
    case "stopped":
      return (
        <p role="status" className={hint}>
          {outcome.restored
            ? `Stopped. The ${project} is back to its state before this run.`
            : "Stopped. The run's changes are still in the project."}
        </p>
      );
    case "error":
      return (
        <div className="flex flex-col gap-2">
          <StatusMessage tone="error">{outcome.message}</StatusMessage>
          {actions ? <button type="button" className={cx(editorUi.buttonSecondary, "self-start")} onClick={onRetry}>Retry</button> : null}
        </div>
      );
    case "changed":
      return <p role="status" className={hint}>Changed {outcome.count === 1 ? "1 screen" : `${outcome.count} screens`}.</p>;
    case "critique":
      return (
        <div className="flex flex-col gap-2">
          <p role="status" className={hint}>The critic changed nothing. Pick the findings to apply.</p>
          <button type="button" className={cx(editorUi.buttonSecondary, "self-start")} onClick={onApplyFindings}>
            Apply findings
          </button>
        </div>
      );
    case "unchanged":
      return <p role="status" className={hint}>No changes to the {project}.</p>;
  }
}

export function TurnView({
  turn,
  live,
  onStop,
  ...outcomeActions
}: {
  turn: AgentTurn;
  live: boolean;
  onStop: () => void;
  onRetry: () => void;
  onSwitchAgent: () => void;
  onAskToFix: (reason: string) => void;
  onApplyFindings: () => void;
}) {
  return (
    <li className="flex flex-col gap-3">
      <p className="max-w-[230px] self-end whitespace-pre-wrap break-words rounded-[10px_10px_3px_10px] bg-[var(--editor-color-surface-muted)] px-2.5 py-2 text-[12.5px] leading-[1.45]">
        <span className="sr-only">You: </span>{turn.message}
      </p>
      {turn.attachments.length > 0 ? (
        <ul aria-label="Attached images" className="flex flex-wrap justify-end gap-1.5">
          {turn.attachments.map(({ file, url }, index) => (
            <li key={index}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={file.name} className={attachmentThumbnail} />
            </li>
          ))}
        </ul>
      ) : null}
      {turn.droppedImages > 0 ? (
        <p className={cx(hint, "self-end")}>
          {turn.droppedImages === 1 ? "1 image" : `${turn.droppedImages} images`} not kept after reload
        </p>
      ) : null}
      <div className={cx("flex flex-col gap-2 p-2.5 text-xs", live ? agentBox : "")}>
        <span className="sr-only">{turn.agentName}: </span>
        {live ? (
          <p role="status" className="flex items-center gap-2 font-semibold text-[color:var(--editor-color-agent-text)]">
            <span aria-hidden="true" className={cx(dot, "bg-[var(--editor-color-agent)] shadow-[0_0_0_3px_rgb(110_68_224/20%)] motion-safe:animate-pulse")} />
            {turnProgressLabel(turn)} · {turnActivity(turn)}
          </p>
        ) : null}
        {turn.steps.length > 0 ? (
          <ol aria-label="Steps" className="flex flex-col gap-1.5">
            {turn.steps.map((step, index) => (
              <li
                key={`${index}-${step.label}`}
                className={cx(
                  "flex items-center gap-2",
                  step.status === "in_progress" && "font-semibold text-[color:var(--editor-color-agent-text)]",
                  step.status === "pending" && "text-[color:var(--editor-color-text-secondary)]",
                )}
              >
                <StepIcon status={step.status} />
                <span>{step.label}</span>
                <span className="sr-only"> ({STEP_STATUS[step.status]})</span>
              </li>
            ))}
          </ol>
        ) : null}
        {live && turn.command ? (
          <p className="truncate font-mono text-[10px] text-[color:var(--editor-color-text-secondary)]" title={turn.command}>
            {turn.command}
          </p>
        ) : null}
        {turn.text.map((text, index) => (
          <p key={index} className="whitespace-pre-wrap break-words text-[12.5px] leading-normal">{text}</p>
        ))}
        {turn.done?.summary && !turn.text.includes(turn.done.summary) ? (
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-normal">{turn.done.summary}</p>
        ) : null}
        {live ? (
          <div className="flex items-center gap-2">
            <button type="button" className={editorUi.buttonSecondary} disabled={turn.stopped} onClick={onStop}>
              {turn.stopped ? "Stopping…" : "Stop"}
            </button>
            <span className={hint}>Stop restores the project file to its state before this run.</span>
          </div>
        ) : <TurnOutcomeView turn={turn} {...outcomeActions} />}
        {!live && turn.result && hasOtherFiles(turn.result.otherFiles) ? <OtherFilesView otherFiles={turn.result.otherFiles} /> : null}
      </div>
    </li>
  );
}
