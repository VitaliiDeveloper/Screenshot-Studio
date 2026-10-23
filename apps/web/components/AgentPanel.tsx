// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { Check, Circle, CircleDot, ImageOff, Paperclip, X } from "lucide-react";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { AGENT_ATTACHMENT_ACCEPT, MAX_AGENT_ATTACHMENTS } from "@web/lib/agents/agent-attachments";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { IssueCounts } from "@web/lib/editor/editor-issues";
import { editorStore } from "@web/lib/editor/editor-store";
import type { EditorAgentChat } from "@web/app/editor/use-editor-agent-chat";
import { cx, editorUi, MenuSelect, StatusMessage } from "./editor-ui";
import { PanelHeader } from "./LeftPanel";
import {
  agentCanRun,
  agentNotice,
  agentStateLabel,
  attachmentFileProblem,
  changedScreenRows,
  policyLevelLabel,
  turnActivity,
  turnOutcome,
  turnProgressLabel,
  type AgentNotice,
  type AgentTurn,
} from "./agent-panel-model";

const agentBox = "rounded-[10px] border border-[var(--editor-color-agent-border)] bg-[var(--editor-color-agent-surface)]";
const agentButton = `${editorUi.buttonBase} bg-[var(--editor-color-agent)] font-semibold text-[color:var(--editor-color-on-accent)] hover:bg-[var(--editor-color-agent-text)]`;
const hint = "text-[11px] leading-[1.45] text-[color:var(--editor-color-text-secondary)]";
const dot = "size-[7px] shrink-0 rounded-full";

/** A file waiting in the composer. A refused file has no thumbnail and says why next to its name. */
interface ComposerAttachment {
  id: number;
  file: File;
  url: string | null;
  error: string | null;
}

const thumbnail = "size-10 shrink-0 rounded-md border border-[var(--editor-color-border)] object-cover";

function ComposerAttachments({
  items,
  notice,
  onRemove,
}: {
  items: ComposerAttachment[];
  notice: string | null;
  onRemove: (id: number) => void;
}) {
  if (items.length === 0 && !notice) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 ? (
        <ul aria-label="Attached images" className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              {item.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.file.name} className={thumbnail} />
              ) : (
                <span aria-hidden="true" className={cx(thumbnail, "flex items-center justify-center text-[color:var(--editor-color-text-faint)]")}>
                  <ImageOff size={16} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs">{item.file.name}</span>
                {item.error ? <span role="alert" className="text-[11px] leading-[1.35] text-[color:var(--editor-color-danger-text)]">{item.error}</span> : null}
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.file.name}`}
                className={cx(editorUi.buttonGhost, "!min-h-6 !px-1.5")}
                onClick={() => onRemove(item.id)}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p role="status" className={hint}>{notice}</p> : null}
      {items.length > 0 ? (
        <p className={hint}>Attached images are sent to {`the agent's`} provider with your request, through your subscription.</p>
      ) : null}
    </div>
  );
}

function AgentDot({ ready }: { ready: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(dot, ready ? "bg-[var(--editor-color-success)]" : "bg-[var(--editor-color-text-faint)]")}
    />
  );
}

const BADGE_TONES = {
  supported: "border-[var(--editor-color-border)] text-[color:var(--editor-color-text-muted)]",
  "at-own-risk": "border-amber-500/60 bg-amber-500/10 text-[color:var(--editor-color-warning-text)]",
  unavailable: "border-[var(--editor-color-border)] bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-secondary)]",
} as const;

function PolicyBadge({ agent }: { agent: AgentStatus }) {
  return (
    <span
      title={agent.policy.reason}
      className={cx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none", BADGE_TONES[agent.policy.level])}
    >
      <span className="sr-only">Policy: </span>{policyLevelLabel(agent)}
    </span>
  );
}

function NoticeCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cx(editorUi.resourceCard, "flex flex-col gap-2.5")}>
      <h3 className={editorUi.sectionLabel}>{label}</h3>
      {children}
    </section>
  );
}

function CheckAgain({ chat }: { chat: EditorAgentChat }) {
  return (
    <button
      type="button"
      className={cx(editorUi.buttonSecondary, "self-start")}
      disabled={chat.checking}
      onClick={() => void chat.refreshAgents()}
    >
      {chat.checking ? "Checking…" : "Check again"}
    </button>
  );
}

function SetupLink({ agent }: { agent: AgentStatus }) {
  if (!agent.setupUrl) return null;
  return (
    <a
      href={agent.setupUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Set up ${agent.name}`}
      className="text-[11px] font-medium text-[color:var(--editor-color-accent)] hover:underline"
    >
      Setup
    </a>
  );
}

function SourceLink({ agent }: { agent: AgentStatus }) {
  return (
    <p className={hint}>
      <a
        href={agent.policy.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-[color:var(--editor-color-accent)] hover:underline"
      >
        Read the terms
      </a>
      {" · "}checked {agent.policy.checkedAt}
    </p>
  );
}

function SignInCommand({ agent }: { agent: AgentStatus }) {
  return agent.signInCommand ? (
    <code className="rounded-[var(--editor-radius-control)] bg-[var(--editor-color-surface-muted)] px-2.5 py-1.5 font-mono text-[11px] text-[color:var(--editor-color-text)]">
      {agent.signInCommand}
    </code>
  ) : null;
}

/** Mockup 7c: why the selected agent cannot run, and what the user does about it. */
function AgentNoticeView({ notice, chat }: { notice: AgentNotice; chat: EditorAgentChat }) {
  const text = "text-[13px] leading-normal text-[color:var(--editor-color-text)]";
  if (notice.kind === "loading") {
    return chat.agentsError ? (
      <NoticeCard label="Agents not checked">
        <StatusMessage tone="error">{chat.agentsError}</StatusMessage>
        <CheckAgain chat={chat} />
      </NoticeCard>
    ) : <p role="status" className={hint}>Checking agents on this computer…</p>;
  }
  if (notice.kind === "no-agent") {
    return (
      <NoticeCard label="No agent found">
        <p className={text}>Install one of these CLIs and sign in with your subscription. The editor works without an agent.</p>
        <ul className="flex flex-col gap-1.5">
          {(chat.agents ?? []).map((agent) => (
            <li key={agent.id} className="flex items-center gap-2 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] px-2.5 py-1.5 text-xs">
              <AgentDot ready={false} />
              <span className="flex-1">{agent.name}</span>
              {agent.state === "unavailable" || agent.state === "no-adapter"
                ? <span className={hint} title={agent.policy.reason}>{agentStateLabel(agent)}</span>
                : <SetupLink agent={agent} />}
            </li>
          ))}
        </ul>
        <CheckAgain chat={chat} />
      </NoticeCard>
    );
  }
  const { agent } = notice;
  switch (notice.kind) {
    case "not-signed-in":
      return (
        <NoticeCard label="Not signed in">
          <p className={text}>{agent.name} is installed but not signed in. Sign in from Terminal; Screenshot Studio never asks for your password or keys.</p>
          <SignInCommand agent={agent} />
          <CheckAgain chat={chat} />
        </NoticeCard>
      );
    case "wrong-auth-mode":
      return (
        <NoticeCard label="Signed in with an API key">
          <p className={text}>{agent.name} is signed in with an API key. Sign in with your subscription from Terminal; Screenshot Studio runs agents only on a subscription.</p>
          <SignInCommand agent={agent} />
          <CheckAgain chat={chat} />
        </NoticeCard>
      );
    case "unsupported-version":
      return (
        <NoticeCard label="Update needed">
          <p className={text}>
            {agent.name}{agent.version ? ` ${agent.version}` : ""} is not a version Screenshot Studio has verified
            {agent.minVersion ? `; update it to ${agent.minVersion} or later.` : "."}
          </p>
          <SetupLink agent={agent} />
          <CheckAgain chat={chat} />
        </NoticeCard>
      );
    case "not-installed":
      return (
        <NoticeCard label="Not installed">
          <p className={text}>Install {agent.name} and sign in with your subscription.</p>
          <SetupLink agent={agent} />
          <CheckAgain chat={chat} />
        </NoticeCard>
      );
    case "unavailable":
      return (
        <NoticeCard label="Unavailable">
          <p className={text}>{agent.policy.reason} {agent.policy.consequences}</p>
        </NoticeCard>
      );
    case "no-adapter":
      return (
        <NoticeCard label="Not supported in the editor yet">
          <p className={text}>{agent.name} is listed with its policy, but the editor cannot run it yet. {agent.policy.reason}</p>
          <SourceLink agent={agent} />
        </NoticeCard>
      );
    case "consent-required":
      return (
        <NoticeCard label={`Use ${agent.name} at your own risk`}>
          <p className={text}>{agent.policy.reason}</p>
          <p className={text}>{agent.policy.consequences}</p>
          <SourceLink agent={agent} />
          {chat.consentError ? <StatusMessage tone="error">{chat.consentError}</StatusMessage> : null}
          <button
            type="button"
            className={cx(agentButton, "self-start")}
            onClick={() => void chat.setConsent(agent.id, "grant")}
          >
            I understand, enable {agent.name}
          </button>
          <p className={hint}>You can withdraw this consent at any time from the panel header.</p>
        </NoticeCard>
      );
  }
}

function StepIcon({ status }: { status: AgentTurn["steps"][number]["status"] }) {
  if (status === "completed") return <Check aria-hidden="true" size={12} className="shrink-0 text-[color:var(--editor-color-success)]" />;
  if (status === "in_progress") return <CircleDot aria-hidden="true" size={12} className="shrink-0 text-[color:var(--editor-color-agent)]" />;
  return <Circle aria-hidden="true" size={12} className="shrink-0 text-[color:var(--editor-color-text-faint)]" />;
}

const STEP_STATUS = { completed: "done", in_progress: "in progress", pending: "to do" } as const;

function TurnOutcomeView({
  turn,
  onRetry,
  onSwitchAgent,
  onAskToFix,
}: {
  turn: AgentTurn;
  onRetry: () => void;
  onSwitchAgent: () => void;
  onAskToFix: (reason: string) => void;
}) {
  const outcome = turnOutcome(turn);
  if (!outcome) return null;
  switch (outcome.kind) {
    case "limit":
      return (
        <div className="flex flex-col gap-2">
          <StatusMessage tone="warning" role="alert">
            Your {turn.agentName} subscription limit {outcome.resets ? `resets ${outcome.resets}` : "is reached"}.
            {outcome.unchanged ? " Nothing in the project was changed." : ""}
          </StatusMessage>
          <div className="flex gap-2">
            <button type="button" className={editorUi.buttonSecondary} onClick={onSwitchAgent}>Switch agent</button>
            <button type="button" className={editorUi.buttonSecondary} onClick={onRetry}>Retry</button>
          </div>
        </div>
      );
    case "rejected":
      return (
        <div className="flex flex-col gap-2">
          <StatusMessage tone="error">
            The agent&apos;s changes didn&apos;t pass schema validation. The project is back to its state before the run.
          </StatusMessage>
          <details className="text-xs text-[color:var(--editor-color-text-muted)]">
            <summary className="cursor-pointer select-none">Show details</summary>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">{outcome.reason}</p>
          </details>
          <button type="button" className={cx(editorUi.buttonSecondary, "self-start")} onClick={() => onAskToFix(outcome.reason)}>
            Ask agent to fix
          </button>
        </div>
      );
    case "stopped":
      return (
        <p role="status" className={hint}>
          {outcome.restored
            ? "Stopped. The project is back to its state before this run."
            : "Stopped. The run's changes are still in the project."}
        </p>
      );
    case "error":
      return (
        <div className="flex flex-col gap-2">
          <StatusMessage tone="error">{outcome.message}</StatusMessage>
          <button type="button" className={cx(editorUi.buttonSecondary, "self-start")} onClick={onRetry}>Retry</button>
        </div>
      );
    case "changed":
      return <p role="status" className={hint}>Changed {outcome.count === 1 ? "1 screen" : `${outcome.count} screens`}.</p>;
    case "unchanged":
      return <p role="status" className={hint}>No changes to the project.</p>;
  }
}

function TurnView({
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
              <img src={url} alt={file.name} className={thumbnail} />
            </li>
          ))}
        </ul>
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
            <span className={hint}>Stop restores the project to its state before this run.</span>
          </div>
        ) : <TurnOutcomeView turn={turn} {...outcomeActions} />}
      </div>
    </li>
  );
}

/** Mockup 7b: what the run changed, the checks, and Keep / Undo run. */
function AgentReview({
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
        <div className="flex flex-col gap-2 px-3.5 py-3 text-xs">
          <h3 className={editorUi.sectionLabel}>Checks</h3>
          <p className="flex items-center gap-2 text-[color:var(--editor-color-text-muted)]">
            <span aria-hidden="true" className={cx(dot, "bg-[var(--editor-color-success)]")} />
            Project passes schema validation
          </p>
          <p className={cx("flex items-center gap-2", issueTotal > 0 ? "text-[color:var(--editor-color-warning-text)]" : "text-[color:var(--editor-color-text-muted)]")}>
            <span aria-hidden="true" className={cx(dot, issueTotal > 0 ? "bg-amber-500" : "bg-[var(--editor-color-success)]")} />
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
        <p className={hint}>Undo run restores the snapshot taken before the run.</p>
      </div>
    </section>
  );
}

export function AgentPanel({
  chat,
  open,
  specs,
  issueCounts,
  onClose,
  onGoToScreen,
  onOpenIssues,
}: {
  chat: EditorAgentChat;
  open: boolean;
  specs: StoreSpecs;
  issueCounts: IssueCounts;
  onClose: () => void;
  onGoToScreen: (screenId: string) => void;
  onOpenIssues: () => void;
}) {
  const composerId = useId();
  const panel = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextAttachmentId = useRef(1);
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  const { agents, selected, phase, turns } = chat;
  const notice = agentNotice(agents, selected);
  const running = phase === "running";
  const reviewing = chat.outcome !== null && !running;
  const canSend = phase === "idle" && agentCanRun(selected) && draft.trim().length > 0
    && attachments.length <= MAX_AGENT_ATTACHMENTS && attachments.every(({ error }) => !error);

  // Thumbnails use object URLs; they are freed when the file leaves the composer or the panel goes.
  useEffect(() => () => {
    for (const { url } of attachmentsRef.current) if (url) URL.revokeObjectURL(url);
  }, []);

  const addFiles = async (files: File[]) => {
    const room = Math.max(0, MAX_AGENT_ATTACHMENTS - attachmentsRef.current.length);
    const accepted = files.slice(0, room);
    setAttachNotice(files.length > accepted.length
      ? `Up to ${MAX_AGENT_ATTACHMENTS} images per message; ${files.length - accepted.length} not added.`
      : null);
    const items = await Promise.all(accepted.map(async (file): Promise<ComposerAttachment> => {
      const error = await attachmentFileProblem(file);
      return { id: nextAttachmentId.current++, file, error, url: error ? null : URL.createObjectURL(file) };
    }));
    setAttachments((current) => [...current, ...items]);
  };
  const removeAttachment = (id: number) => {
    const removed = attachmentsRef.current.find((item) => item.id === id);
    if (removed?.url) URL.revokeObjectURL(removed.url);
    setAttachments((current) => current.filter((item) => item.id !== id));
    setAttachNotice(null);
    composer.current?.focus();
  };
  const replaceAttachments = (files: File[]) => {
    for (const { url } of attachmentsRef.current) if (url) URL.revokeObjectURL(url);
    setAttachments(files.map((file) => ({ id: nextAttachmentId.current++, file, error: null, url: URL.createObjectURL(file) })));
    setAttachNotice(null);
  };
  const dragHasFiles = (event: DragEvent<HTMLElement>) => !reviewing && event.dataTransfer.types.includes("Files");

  useEffect(() => {
    if (open) composer.current?.focus();
  }, [open]);
  // Stop disappears when a run ends, and the review and the composer replace each other; keep focus
  // in the panel instead of dropping it on the page.
  useEffect(() => {
    if (phase !== "idle" || document.activeElement !== document.body) return;
    (composer.current ?? panel.current?.querySelector<HTMLElement>("[data-agent-review-focus]"))?.focus();
  }, [phase, reviewing]);

  const submit = () => {
    if (!canSend) return;
    const message = draft;
    const files = attachments.map(({ file }) => file);
    setDraft("");
    // The turn keeps its own copies of the thumbnails, so the composer frees its URLs.
    for (const { url } of attachments) if (url) URL.revokeObjectURL(url);
    setAttachments([]);
    setAttachNotice(null);
    void chat.send(message, files);
  };
  const focusPicker = () => picker.current?.querySelector("button")?.focus();

  return (
    <aside
      ref={panel}
      aria-label="Agent"
      onDragEnter={(event) => {
        if (dragHasFiles(event)) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!dragHasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        void addFiles([...event.dataTransfer.files]);
      }}
      className="relative flex h-full w-full shrink-0 flex-col overflow-hidden border-r border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] shadow-xl shadow-slate-950/10 xl:shadow-[1px_0_0_rgba(15,23,42,0.02)]"
    >
      {dragging ? (
        <div
          data-agent-drop-zone
          className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--editor-color-agent)] bg-[var(--editor-color-agent-surface)]/90 p-4 text-center text-xs font-semibold text-[color:var(--editor-color-agent-text)]"
        >
          Drop PNG, JPEG or WebP images to attach them to your next request
        </div>
      ) : null}
      <PanelHeader title="Agent" onClose={onClose} />
      <div className="flex flex-col gap-2 border-b border-[var(--editor-color-border)] px-3.5 py-3">
        <div className="flex items-center justify-between">
          <h3 className={editorUi.sectionLabel}>{reviewing ? "Agent · review" : "Agent"}</h3>
          <button
            type="button"
            className={cx(editorUi.buttonGhost, "!min-h-6 !px-1.5 text-xs")}
            disabled={phase !== "idle" || turns.length === 0}
            onClick={chat.newChat}
          >
            New chat
          </button>
        </div>
        {agents && selected && notice?.kind !== "no-agent" ? (
          <div ref={picker} className="flex items-center gap-2">
            <MenuSelect
              ariaLabel="Agent"
              value={selected.id}
              options={agents.map((agent) => ({
                value: agent.id,
                label: [agent.name, agent.policy.level === "at-own-risk" ? policyLevelLabel(agent) : null, agentStateLabel(agent)]
                  .filter(Boolean).join(" · "),
                triggerLabel: agent.name,
              }))}
              onChange={chat.selectAgent}
              density="compact"
              wrapLabels
              // The panel clips overflow, so the menu opens from the trigger's start edge at panel width.
              menuClassName="!left-0 !right-auto w-[260px]"
              className="min-w-0 flex-1"
            />
            {selected.models.length > 0 && chat.selectedModel ? (
              <MenuSelect
                ariaLabel="Model"
                value={chat.selectedModel}
                options={selected.models.map((model) => ({ value: model, label: model }))}
                onChange={chat.selectModel}
                density="compact"
                className="w-24 shrink-0"
              />
            ) : <span className={hint}>CLI default model</span>}
          </div>
        ) : null}
        {selected ? (
          <div className="flex items-center gap-2">
            <PolicyBadge agent={selected} />
            {selected.policy.level === "at-own-risk" && selected.consented === true ? (
              <button
                type="button"
                className={cx(editorUi.buttonGhost, "!min-h-6 !px-1.5 text-xs")}
                disabled={phase !== "idle"}
                onClick={() => void chat.setConsent(selected.id, "revoke")}
              >
                Revoke consent
              </button>
            ) : null}
          </div>
        ) : null}
        {selected?.consented === true && chat.consentError ? <StatusMessage tone="error">{chat.consentError}</StatusMessage> : null}
        <p className={hint}>Your subscription · runs on this computer</p>
      </div>
      {reviewing ? (
        <AgentReview chat={chat} specs={specs} issueCounts={issueCounts} onGoToScreen={onGoToScreen} onOpenIssues={onOpenIssues} />
      ) : (
        <>
          <div className="editor-scroll-area flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {notice ? <AgentNoticeView notice={notice} chat={chat} /> : null}
            {turns.length === 0 && !notice ? (
              <p className={hint}>
                Describe a change to this project. {selected?.name ?? "The agent"} edits it through the screenshots CLI, and you review the result before you keep it.
              </p>
            ) : null}
            {turns.length > 0 ? (
              <ol aria-label="Messages" className="flex flex-col gap-4">
                {turns.map((turn, index) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    live={running && index === turns.length - 1}
                    onStop={() => void chat.stop()}
                    onRetry={() => void chat.send(turn.message, turn.attachments.map(({ file }) => file))}
                    onSwitchAgent={focusPicker}
                    onAskToFix={(reason) => {
                      setDraft(`The last run's changes failed schema validation and were rolled back:\n${reason}\nPlease try again and keep the project valid.`);
                      replaceAttachments(turn.attachments.map(({ file }) => file));
                      composer.current?.focus();
                    }}
                  />
                ))}
              </ol>
            ) : null}
          </div>
          <form
            className="flex flex-col gap-2 border-t border-[var(--editor-color-border)] px-3 pb-3 pt-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <ComposerAttachments items={attachments} notice={attachNotice} onRemove={removeAttachment} />
            <label htmlFor={composerId} className="sr-only">Message to {selected?.name ?? "the agent"}</label>
            <textarea
              ref={composer}
              id={composerId}
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const images = [...event.clipboardData.files];
                if (images.length === 0) return;
                // Text that came along with the image still pastes.
                if (!event.clipboardData.getData("text/plain")) event.preventDefault();
                void addFiles(images);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
              }}
              placeholder={running ? "The agent is working. You can type the next request." : "Describe a change to this project"}
              className={cx(editorUi.textarea, "resize-none text-xs")}
            />
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept={AGENT_ATTACHMENT_ACCEPT}
              onChange={(event) => {
                void addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Attach images"
                title="Attach images (or drop or paste them)"
                className={cx(editorUi.buttonGhost, "!min-h-7 !px-1.5")}
                disabled={attachments.length >= MAX_AGENT_ATTACHMENTS}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip aria-hidden="true" size={14} />
              </button>
              <span className={cx(hint, "flex-1")}>{running ? "Send when this run ends" : "Enter sends · Shift+Enter adds a line"}</span>
              <button type="submit" className={agentButton} disabled={!canSend}>Send</button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
}

/** Mockup 7a: the canvas banner while a run owns the project. */
export function AgentRunBanner({ chat }: { chat: EditorAgentChat }) {
  const name = chat.turns.at(-1)?.agentName ?? chat.selected?.name ?? "The agent";
  const stopping = chat.turns.at(-1)?.stopped ?? false;
  return (
    <div className={cx(agentBox, "absolute inset-x-4 top-3.5 z-40 flex items-center gap-2.5 px-3 py-2 text-xs shadow-[var(--editor-shadow-control)]")}>
      <span aria-hidden="true" className={cx(dot, "bg-[var(--editor-color-agent)]")} />
      <span className="font-semibold text-[color:var(--editor-color-agent-text)]">
        {chat.phase === "running" ? `${name} is editing this project` : "Updating the canvas from the agent run…"}
      </span>
      <span className="hidden text-[color:var(--editor-color-text-muted)] lg:inline">Editing, Export and Undo are paused until it finishes.</span>
      <span className="flex-1" />
      {chat.phase === "running" ? (
        <button
          type="button"
          aria-label={`Stop ${name}`}
          className={cx(editorUi.buttonSecondary, "!min-h-7")}
          disabled={stopping}
          onClick={() => void chat.stop()}
        >
          {stopping ? "Stopping…" : "Stop"}
        </button>
      ) : null}
    </div>
  );
}
