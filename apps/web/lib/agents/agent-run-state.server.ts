// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import { cancelRunsOnShutdown } from "./agent-run-shutdown.server.js";
import type { AgentRunOutcome } from "./agent-session.server.js";

interface PendingOutcome {
  snapshot: Project;
  outcome: AgentRunOutcome;
}

const ACTIVE_RUNS_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-runs");
const EDITOR_WRITES_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-editor-writes");
const OUTCOMES_GLOBAL_KEY = Symbol.for("screenshot-studio.agent-outcomes");

// Shared across Next dev module evaluations like the project session registry, so a recompiled
// route sees the same runs and snapshots.
function serverGlobalMap<T>(key: symbol, onCreate?: (map: Map<string, T>) => void): Map<string, T> {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[key] as Map<string, T> | undefined;
  if (existing) return existing;
  const created = new Map<string, T>();
  serverGlobal[key] = created;
  onCreate?.(created);
  return created;
}

// Keyed by the project folder's real path, so one project never runs two agents at once.
export function activeRuns(): Map<string, () => void> {
  return serverGlobalMap<() => void>(ACTIVE_RUNS_GLOBAL_KEY, (runs) => cancelRunsOnShutdown(() => {
    for (const cancel of runs.values()) cancel();
  }));
}

// shortcut: snapshots live in server memory, so a server restart drops a pending Undo run; persist
// them under the project folder when the chat needs Undo to survive restarts.
export function pendingOutcomes(): Map<string, PendingOutcome> {
  return serverGlobalMap<PendingOutcome>(OUTCOMES_GLOBAL_KEY);
}

// Editor writes in flight per project folder. A run reserves its slot, then waits for this count to
// drain before its snapshot; an editor write checks the slot and counts itself in one synchronous
// step. So no editor write can land between a run's snapshot and its verdict, where Undo or a
// rejected result would silently drop it.
export function editorWrites(): Map<string, number> {
  return serverGlobalMap<number>(EDITOR_WRITES_GLOBAL_KEY);
}
