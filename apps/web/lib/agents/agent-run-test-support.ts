// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";

/** Marks an agent run as active on a project folder, as a running editor agent does; returns its release. */
export async function holdAgentRun(projectDir: string): Promise<() => void> {
  const key = Symbol.for("screenshot-studio.agent-runs");
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: Map<string, () => void> | undefined };
  const runs = serverGlobal[key] ??= new Map();
  const resolved = await realpath(projectDir);
  runs.set(resolved, () => undefined);
  return () => { runs.delete(resolved); };
}
