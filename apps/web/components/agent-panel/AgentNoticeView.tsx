// SPDX-License-Identifier: Apache-2.0
"use client";

import type { ReactNode } from "react";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { EditorAgentChat } from "@web/app/editor/use-editor-agent-chat";
import { cx, editorUi, StatusMessage } from "@web/components/editor-ui";
import { agentStateLabel, type AgentNotice } from "@web/components/agent-panel-model";
import { agentButton, dot, hint } from "./agent-panel-styles";

function AgentDot({ ready }: { ready: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(dot, ready ? "bg-[var(--editor-color-success)]" : "bg-[var(--editor-color-text-faint)]")}
    />
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
      className="text-[11px] font-medium text-[color:var(--editor-color-accent-text)] hover:underline"
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
        className="font-medium text-[color:var(--editor-color-accent-text)] hover:underline"
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
export function AgentNoticeView({ notice, chat }: { notice: AgentNotice; chat: EditorAgentChat }) {
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
