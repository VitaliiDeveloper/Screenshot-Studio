// SPDX-License-Identifier: Apache-2.0
"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { IssueCounts } from "@web/lib/editor/editor-issues";
import type { EditorAgentChat } from "@web/app/editor/use-editor-agent-chat";
import { AgentPicker } from "./AgentPicker";
import { ComposerAttachButton, ComposerAttachments, useComposerAttachments } from "./ComposerAttachments";
import { cx, editorUi, StatusMessage } from "./editor-ui";
import { PanelHeader } from "./LeftPanel";
import {
  AGENT_QUICK_ACTIONS,
  agentCanRun,
  agentNotice,
  criticFixDraft,
  policyLevelLabel,
} from "./agent-panel-model";
import { agentBox, agentButton, dot, hint } from "./agent-panel/agent-panel-styles";
import { AgentNoticeView } from "./agent-panel/AgentNoticeView";
import { AgentReview } from "./agent-panel/AgentReview";
import { TurnView } from "./agent-panel/TurnView";

const BADGE_TONES = {
  supported: "border-[var(--editor-color-border)] text-[color:var(--editor-color-text-muted)]",
  "at-own-risk": "border-[var(--editor-color-warning-border-strong)] bg-[var(--editor-color-warning-surface)] text-[color:var(--editor-color-warning-text)]",
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
  const attachments = useComposerAttachments();
  const { agents, selected, phase, turns } = chat;
  const notice = agentNotice(agents, selected);
  const running = phase === "running";
  const reviewing = chat.outcome !== null && !running;
  const canCritique = phase === "idle" && agentCanRun(selected);
  const canSend = canCritique && draft.trim().length > 0 && attachments.ready;

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
    const { files } = attachments;
    setDraft("");
    // The turn keeps its own copies of the thumbnails, so the composer frees its URLs.
    attachments.replace([]);
    void chat.send(message, files);
  };
  const focusPicker = () => picker.current?.querySelector("button")?.focus();

  return (
    <aside
      ref={panel}
      aria-label="Agent"
      {...attachments.dropTarget(!reviewing)}
      className="relative flex h-full w-full shrink-0 flex-col overflow-hidden border-r border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] shadow-xl shadow-slate-950/10 xl:shadow-[1px_0_0_rgba(15,23,42,0.02)]"
    >
      {attachments.dragging ? (
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
          <div ref={picker}>
            <AgentPicker
              layout="stacked"
              agents={agents}
              agent={selected}
              model={chat.selectedModel}
              effort={chat.selectedEffort}
              onAgentChange={chat.selectAgent}
              onModelChange={chat.selectModel}
              onEffortChange={chat.selectEffort}
            />
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
              <>
                <p className={hint}>
                  Describe a change to this project. {selected?.name ?? "The agent"} edits it through the screenshots CLI, and you review the result before you keep it.
                </p>
                <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-1.5">
                  {AGENT_QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className={cx(editorUi.buttonSecondary, "!min-h-7 !px-2 text-xs")}
                      onClick={() => {
                        setDraft(action.prompt);
                        composer.current?.focus();
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                  <button type="button" className={cx(editorUi.buttonSecondary, "!min-h-7 !px-2 text-xs")} disabled={!canCritique} onClick={() => void chat.critique()}>
                    Critique my set
                  </button>
                </div>
              </>
            ) : null}
            {turns.length > 0 ? (
              <ol aria-label="Messages" className="flex flex-col gap-4">
                {turns.map((turn, index) => (
                  <Fragment key={turn.id}>
                    <TurnView
                      turn={turn}
                      live={running && index === turns.length - 1}
                      onStop={() => void chat.stop()}
                      onRetry={() => void chat.send(turn.message, turn.attachments.map(({ file }) => file), turn.mode)}
                      onSwitchAgent={focusPicker}
                      onAskToFix={(reason) => {
                        setDraft(`The last run's changes failed schema validation and were rolled back:\n${reason}\nPlease try again and keep the project valid.`);
                        attachments.replace(turn.attachments.map(({ file }) => file));
                        composer.current?.focus();
                      }}
                      onApplyFindings={() => {
                        setDraft(criticFixDraft(turn));
                        composer.current?.focus();
                      }}
                    />
                    {turn.earlier && !turns[index + 1]?.earlier ? (
                      <li role="separator" className={cx(hint, "border-t border-[var(--editor-color-border)] pt-2 text-center")}>
                        Restored after the page reloaded
                      </li>
                    ) : null}
                  </Fragment>
                ))}
              </ol>
            ) : null}
            {chat.criticOffered && phase === "idle" ? (
              <section aria-label="Critic review" className={cx(agentBox, "flex flex-col gap-2 p-2.5 text-xs")}>
                <p className="text-[12.5px] leading-normal">
                  Want a second opinion? The critic exports the set, reviews it against store best practices, and changes nothing.
                </p>
                <div className="flex gap-2">
                  <button type="button" className={agentButton} disabled={!canCritique} onClick={() => void chat.critique()}>Run critic</button>
                  <button type="button" className={editorUi.buttonSecondary} onClick={chat.dismissCritic}>Not now</button>
                </div>
              </section>
            ) : null}
          </div>
          <form
            className="flex flex-col gap-2 border-t border-[var(--editor-color-border)] px-3 pb-3 pt-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <ComposerAttachments
              items={attachments.items}
              notice={attachments.notice}
              onRemove={(id) => {
                attachments.remove(id);
                composer.current?.focus();
              }}
            />
            <label htmlFor={composerId} className="sr-only">Message to {selected?.name ?? "the agent"}</label>
            <textarea
              ref={composer}
              id={composerId}
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={attachments.paste}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
              }}
              placeholder={running ? "The agent is working. You can type the next request." : "Describe a change to this project"}
              className={cx(editorUi.textarea, "resize-none text-xs")}
            />
            <div className="flex items-center gap-2">
              <ComposerAttachButton disabled={attachments.full} onFiles={(files) => void attachments.add(files)} />
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
