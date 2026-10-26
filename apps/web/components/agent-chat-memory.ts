// SPDX-License-Identifier: Apache-2.0
import type { AgentTurn } from "./agent-panel-model";

const CHAT_PREFIX = "screenshot-studio:agent-chat:v1:";
const CHOICE_KEY = "screenshot-studio:agent-choice:v1";
// Streamed text and steps grow every turn; older turns fall off so one tab stays well under quota.
const MAX_TURNS = 30;

/** The agent, model, and effort the user last picked; the registry decides whether they still apply. */
export interface AgentChoice {
  agentId: string | null;
  model: string | null;
  effort: string | null;
}

type StoredTurn = Omit<AgentTurn, "attachments" | "earlier">;

function storageOf(kind: "localStorage" | "sessionStorage", storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof globalThis[kind] === "undefined" ? null : globalThis[kind];
  } catch {
    return null;
  }
}

function chatKey(projectId: string): string {
  return `${CHAT_PREFIX}${encodeURIComponent(projectId)}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readAgentChoice(storage?: Storage): AgentChoice | null {
  try {
    const value = storageOf("localStorage", storage)?.getItem(CHOICE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AgentChoice> & { version?: unknown };
    if (parsed.version !== 1) return null;
    return { agentId: stringOrNull(parsed.agentId), model: stringOrNull(parsed.model), effort: stringOrNull(parsed.effort) };
  } catch {
    return null;
  }
}

export function writeAgentChoice(choice: AgentChoice, storage?: Storage): void {
  try {
    storageOf("localStorage", storage)?.setItem(CHOICE_KEY, JSON.stringify({ version: 1, ...choice }));
  } catch {
    // Blocked storage only means the next page load starts from the defaults.
  }
}

function isStoredTurn(value: unknown): value is StoredTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Partial<StoredTurn>;
  return typeof turn.id === "number"
    && typeof turn.agentName === "string"
    && typeof turn.message === "string"
    && Array.isArray(turn.text)
    && Array.isArray(turn.steps);
}

/** The project's chat from before a reload, marked as earlier; a run the reload cut off reads as failed. */
export function readAgentChat(projectId: string, storage?: Storage): AgentTurn[] {
  try {
    const value = storageOf("sessionStorage", storage)?.getItem(chatKey(projectId));
    if (!value) return [];
    const parsed = JSON.parse(value) as { version?: unknown; turns?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.turns)) return [];
    return parsed.turns.filter(isStoredTurn).map((turn) => ({
      ...turn,
      attachments: [],
      earlier: true,
      droppedImages: typeof turn.droppedImages === "number" ? turn.droppedImages : 0,
      error: turn.done ? turn.error : turn.error ?? { code: "failed", message: "The page reloaded before this run finished.", resets: null },
      done: turn.done ?? { type: "done", status: "failed", summary: null, durationMs: null },
    }));
  } catch {
    return [];
  }
}

/** Keeps the chat's text for this tab only; image files cannot outlive the page, so only their count stays. */
export function writeAgentChat(projectId: string, turns: readonly AgentTurn[], storage?: Storage): void {
  try {
    const target = storageOf("sessionStorage", storage);
    if (!target) return;
    if (turns.length === 0) {
      target.removeItem(chatKey(projectId));
      return;
    }
    const stored: StoredTurn[] = turns.slice(-MAX_TURNS).map(({ attachments, earlier: _earlier, ...turn }) => ({
      ...turn,
      droppedImages: turn.droppedImages + attachments.length,
    }));
    target.setItem(chatKey(projectId), JSON.stringify({ version: 1, turns: stored }));
  } catch {
    // Quota or blocked storage: the chat still lives in editor memory until the page reloads.
  }
}
