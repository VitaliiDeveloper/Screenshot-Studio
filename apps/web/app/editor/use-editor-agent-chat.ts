// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { AgentRunOutcome } from "@web/lib/agents/agent-session.server";
import {
  applyAgentEvent,
  createAgentEventParser,
  agentCanRun,
  createAgentTurn,
  defaultAgentId,
  type AgentTurnAttachment,
  type AgentResult,
  type AgentTurn,
} from "@web/components/agent-panel-model";
import { projectRequestHeaders } from "@web/lib/clients/save-project";
import { flushScheduledSave } from "@web/lib/editor/debounced-save";
import { readJsonBody, responseErrorMessage } from "@web/lib/json-response";

/** `running` and `syncing` (verdict reload, Undo run) own the project, so the editor pauses writes. */
export type AgentChatPhase = "idle" | "running" | "syncing";

const AGENT_STATES = new Set([
  "not-installed", "unsupported-version", "not-signed-in", "wrong-auth-mode", "unavailable", "no-adapter", "consent-required",
]);

function attachmentsOf(files: readonly File[]): AgentTurnAttachment[] {
  return files.map((file) => ({ file, url: URL.createObjectURL(file) }));
}

function revokeAttachments(turns: readonly AgentTurn[]): void {
  for (const turn of turns) for (const { url } of turn.attachments) URL.revokeObjectURL(url);
}

function jsonHeaders(): Headers {
  return projectRequestHeaders({ headers: { "content-type": "application/json" } });
}

async function postOutcome(action: "keep" | "undo"): Promise<void> {
  const response = await fetch("/api/agents/outcome", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    throw new Error(responseErrorMessage(await readJsonBody(response), `The agent run could not be updated (${response.status})`));
  }
}

/**
 * The Agent panel's state. It lives in the Workspace, above its loading screen, because the
 * session route cancels a run when its stream closes: a resource reload or a panel switch must not.
 */
export function useEditorAgentChat(open: boolean, reloadFromDisk: () => Promise<boolean>) {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [phase, setPhase] = useState<AgentChatPhase>("idle");
  const [outcome, setOutcome] = useState<AgentRunOutcome | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const turnsRef = useRef<AgentTurn[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  const nextTurnId = useRef(1);
  const stopped = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const responded = useRef(false);
  const mounted = useRef(true);
  const loaded = useRef(false);

  const selected = agents?.find((agent) => agent.id === agentId);
  const selectedModel = selected && model && selected.models.includes(model) ? model : selected?.models[0] ?? null;

  const refreshAgents = useCallback(async () => {
    await Promise.resolve();
    setChecking(true);
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const body = await readJsonBody(response);
      if (!response.ok || !Array.isArray(body.agents)) {
        throw new Error(responseErrorMessage(body, `Agents could not be checked (${response.status})`));
      }
      const list = body.agents as AgentStatus[];
      setAgents(list);
      setAgentsError(null);
      setAgentId((current) => defaultAgentId(list, current));
    } catch (error) {
      setAgentsError((error as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadOutcome = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/outcome", { headers: projectRequestHeaders(), cache: "no-store" });
      if (!response.ok) return;
      const body = await readJsonBody(response);
      setOutcome((body.outcome as AgentRunOutcome | null | undefined) ?? null);
    } catch {
      // Without the pending outcome the review stays hidden; nothing on disk depends on it.
    }
  }, []);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void refreshAgents();
    void loadOutcome();
  }, [loadOutcome, open, refreshAgents]);

  // Leaving the editor closes the stream, which stops the run on the server.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      revokeAttachments(turnsRef.current);
    };
  }, []);

  const send = useCallback(async (message: string, files: readonly File[] = []): Promise<boolean> => {
    const agent = selected;
    if (!agentCanRun(agent) || phase !== "idle" || !message.trim()) return false;
    const id = nextTurnId.current++;
    const update = (change: (turn: AgentTurn) => AgentTurn) => {
      setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));
    };
    const refuse = (code: string, text: string) => update((turn) => ({
      ...turn,
      error: { code, message: text, resets: null },
      done: turn.done ?? { type: "done", status: "failed", summary: null, durationMs: null },
    }));
    const turnAttachments = attachmentsOf(files);
    setTurns((all) => [...all, createAgentTurn(id, agent.name, message, turnAttachments)]);
    setPhase("running");
    setOutcomeError(null);
    stopped.current = false;
    responded.current = false;
    const controller = new AbortController();
    abort.current = controller;
    let result: AgentResult | null = null;
    let finished = false;
    let launched = false;
    try {
      // A debounced edit that fired mid-run would be refused, so the run starts from saved work.
      await flushScheduledSave();
      // Images go with the request in one multipart body; the browser sets its boundary header.
      const form = new FormData();
      form.set("agentId", agent.id);
      form.set("message", message);
      if (selectedModel) form.set("model", selectedModel);
      for (const file of files) form.append("image", file);
      const response = await fetch("/api/agents/session", {
        method: "POST",
        headers: files.length > 0 ? projectRequestHeaders() : jsonHeaders(),
        body: files.length > 0 ? form : JSON.stringify({ agentId: agent.id, message, model: selectedModel }),
        signal: controller.signal,
      });
      responded.current = true;
      if (!response.ok || !response.body) {
        const body = await readJsonBody(response);
        const code = typeof body.code === "string" ? body.code : "failed";
        refuse(code, responseErrorMessage(body, `${agent.name} could not start (${response.status})`));
        if (AGENT_STATES.has(code)) void refreshAgents();
        setPhase("idle");
        return false;
      }
      launched = true;
      // The server drops the previous run's snapshot once this one starts.
      setOutcome(null);
      const parse = createAgentEventParser();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        for (const event of parse(next.value)) {
          if (event.type === "result") result = event;
          if (event.type === "done") finished = true;
          update((turn) => applyAgentEvent(turn, event));
        }
      }
      if (!finished) refuse("failed", "The connection to the agent run was lost.");
    } catch (error) {
      if (!mounted.current) return false;
      refuse("failed", controller.signal.aborted
        ? "The run stopped before its result reached the editor."
        : (error as Error).message);
    } finally {
      abort.current = null;
    }
    if (!mounted.current) return true;

    setPhase("syncing");
    try {
      if (result?.status === "accepted" && result.changed) {
        setOutcome({ revision: result.revision, changedScreens: result.changedScreens, finishedAt: new Date().toISOString() });
        // Mockup 7a: Stop puts the project back where the run found it.
        if (stopped.current) {
          await postOutcome("undo");
          setOutcome(null);
          update((turn) => ({ ...turn, restored: true }));
        }
      }
    } catch (error) {
      setOutcomeError((error as Error).message);
    }
    if (result?.status === "rejected" || result?.changed || (launched && !finished)) await reloadFromDisk();
    if (launched && !finished) await loadOutcome();
    setPhase("idle");
    return true;
  }, [loadOutcome, phase, refreshAgents, reloadFromDisk, selected, selectedModel]);

  const stop = useCallback(async () => {
    if (phase !== "running" || stopped.current) return;
    stopped.current = true;
    setTurns((all) => all.map((turn, index) => (index === all.length - 1 ? { ...turn, stopped: true } : turn)));
    try {
      const response = await fetch("/api/agents/session", { method: "DELETE", headers: projectRequestHeaders() });
      // A 404 before the session answered is Stop during the upload: no run exists yet, and
      // leaving the request cancels the run the moment it starts.
      if (response.status === 404 && !responded.current) abort.current?.abort();
      if (response.ok || response.status === 404) return;
    } catch {
      // Fall through: closing the stream also stops the run, without a verdict on this page.
    }
    abort.current?.abort();
  }, [phase]);

  const setConsent = useCallback(async (agentId: string, action: "grant" | "revoke") => {
    setConsentError(null);
    try {
      const response = await fetch("/api/agents/consent", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ agentId, action }),
      });
      if (!response.ok) {
        throw new Error(responseErrorMessage(await readJsonBody(response), `Consent could not be saved (${response.status})`));
      }
      await refreshAgents();
    } catch (error) {
      setConsentError((error as Error).message);
    }
  }, [refreshAgents]);

  const keep = useCallback(async () => {
    setOutcomeError(null);
    try {
      await postOutcome("keep");
      setOutcome(null);
    } catch (error) {
      setOutcomeError((error as Error).message);
    }
  }, []);

  const undo = useCallback(async () => {
    if (phase !== "idle") return;
    setPhase("syncing");
    setOutcomeError(null);
    try {
      // A pending edit must reach disk first, so Undo run refuses it instead of overwriting it.
      await flushScheduledSave();
      await postOutcome("undo");
      setOutcome(null);
      await reloadFromDisk();
    } catch (error) {
      setOutcomeError((error as Error).message);
    } finally {
      setPhase("idle");
    }
  }, [phase, reloadFromDisk]);

  const selectAgent = useCallback((id: string) => {
    setAgentId(id);
    setModel(null);
    setConsentError(null);
  }, []);

  const newChat = useCallback(() => {
    if (phase !== "idle") return;
    revokeAttachments(turnsRef.current);
    setTurns([]);
  }, [phase]);

  return {
    agents,
    agentsError,
    checking,
    selected,
    selectedModel,
    turns,
    phase,
    locked: phase !== "idle",
    outcome,
    outcomeError,
    consentError,
    setConsent,
    refreshAgents,
    selectAgent,
    selectModel: setModel,
    send,
    stop,
    keep,
    undo,
    newChat,
  };
}

export type EditorAgentChat = ReturnType<typeof useEditorAgentChat>;
