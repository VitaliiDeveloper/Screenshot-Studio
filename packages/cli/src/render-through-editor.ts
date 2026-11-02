// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentRenderRequest,
  AgentRenderResponse,
  RENDER_HEARTBEAT_STALE_MS,
  RENDER_INBOX_ENV,
  RENDER_PICKUP_TIMEOUT_MS,
  renderPickedFile,
  renderRequestFile,
  renderResponseFile,
} from "@screenshot-studio/core/agent-render";

export type EditorRenderCommand = AgentRenderRequest["command"];

const AGENT_FLAGS: Record<EditorRenderCommand, ReadonlySet<string>> = {
  export: new Set(["screen", "size", "layout", "locale", "platform", "device", "profile"]),
  check: new Set(["render", "json", "strict", "layout"]),
};
const POLL_MS = 100;

/** The inbox of the editor run this CLI is inside, or undefined in a terminal. */
export function editorRenderInbox(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[RENDER_INBOX_ENV] || undefined;
}

function buildRequest(command: EditorRenderCommand, flags: Record<string, string>): AgentRenderRequest {
  const refused = Object.keys(flags).filter((flag) => !AGENT_FLAGS[command].has(flag));
  if (refused.length > 0) {
    const names = refused.map((flag) => `--${flag}`).join(", ");
    throw new Error(
      `${names} is not available inside an editor run: the editor renders this run's project and writes to its export/ folder. Run the command again without it.`,
    );
  }
  const booleans = ["render", "json", "strict"];
  return AgentRenderRequest.parse({
    command,
    flags: Object.fromEntries(Object.entries(flags).map(([flag, value]) => [flag, booleans.includes(flag) ? true : value])),
  });
}

async function readResponse(path: string): Promise<AgentRenderResponse | null> {
  const bytes = await readFile(path, "utf8").catch(() => null);
  return bytes === null ? null : AgentRenderResponse.parse(JSON.parse(bytes));
}

/** Null once the marker is gone, or before the editor created it. */
async function heartbeat(path: string): Promise<number | null> {
  return stat(path).then(({ mtimeMs }) => mtimeMs, () => null);
}

export interface EditorRenderTiming {
  pollMs?: number;
  pickupTimeoutMs?: number;
  heartbeatStaleMs?: number;
}

/**
 * Asks the editor that started this run to render, and waits for its answer. A long bundle export
 * stays alive through the editor's heartbeat, while a dead editor still ends the wait.
 */
export async function renderThroughEditor(
  command: EditorRenderCommand,
  flags: Record<string, string>,
  inbox: string,
  {
    pollMs = POLL_MS,
    pickupTimeoutMs = RENDER_PICKUP_TIMEOUT_MS,
    heartbeatStaleMs = RENDER_HEARTBEAT_STALE_MS,
  }: EditorRenderTiming = {},
): Promise<{ output: string; exitCode: number }> {
  const request = buildRequest(command, flags);
  const id = randomUUID();
  const draft = join(inbox, `.draft-${id}`);
  await writeFile(draft, JSON.stringify(request), { flag: "wx", mode: 0o600 });
  await rename(draft, join(inbox, renderRequestFile(id)));

  const markerPath = join(inbox, renderPickedFile(id));
  const responsePath = join(inbox, renderResponseFile(id));
  const started = Date.now();
  let lastBeat: number | null = null;
  let lastChange = started;
  try {
    for (;;) {
      const response = await readResponse(responsePath);
      if (response) {
        if (!response.ok) throw new Error(response.message);
        return { output: response.output, exitCode: response.exitCode };
      }
      const beat = await heartbeat(markerPath);
      const now = Date.now();
      if (beat !== lastBeat && beat !== null) {
        lastBeat = beat;
        lastChange = now;
      }
      if (lastBeat === null && now - started > pickupTimeoutMs) {
        throw new Error(`The editor did not pick up this render within ${Math.round(pickupTimeoutMs / 1000)} seconds, so it is not listening. Rendering needs the editor that started this run.`);
      }
      if (lastBeat !== null && (beat === null || now - lastChange > heartbeatStaleMs)) {
        throw new Error("The editor stopped responding during this render. Rendering needs the editor that started this run.");
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    await Promise.all([renderRequestFile(id), renderPickedFile(id), renderResponseFile(id)].map(
      (name) => rm(join(inbox, name), { force: true }).catch(() => undefined),
    ));
  }
}
