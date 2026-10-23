// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { errorText } from "@screenshot-studio/core/storage";
import { jsonError } from "@web/lib/api-error-response.server.js";
import {
  AgentRunError,
  cancelAgentRun,
  startAgentRun,
  type AgentRun,
  type AgentRunOptions,
} from "@web/lib/agents/agent-session.server.js";
import { isRecord } from "@web/lib/json-guards.js";

export type AgentSessionDependencies = Pick<AgentRunOptions, "env" | "timeoutMs" | "definitions" | "consent"> & {
  heartbeatMs?: number;
};

const MESSAGE_LIMIT = 20_000;
const HEARTBEAT_MS = 15_000;

// The comment frame keeps proxies from closing a stream that is silent during a long CLI step; an
// idle-timeout close would otherwise cancel the run mid-write.
function sseStream(run: AgentRun, heartbeatMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = run.events.getReader();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), heartbeatMs);
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        clearInterval(heartbeat);
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    cancel(reason) {
      clearInterval(heartbeat);
      return reader.cancel(reason);
    },
  });
}

/** Starts a run and streams its normalized events as SSE; closing the stream cancels the run. */
export async function handleAgentSessionPost(
  projectPath: string,
  req: Request,
  dependencies: AgentSessionDependencies = {},
): Promise<Response> {
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || typeof body.agentId !== "string") {
    return jsonError(400, "request body must be a JSON object with an agentId");
  }
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MESSAGE_LIMIT) {
    return jsonError(400, `message must be non-empty text of at most ${MESSAGE_LIMIT} characters`);
  }
  if (body.model != null && typeof body.model !== "string") return jsonError(400, "model must be a string");
  const { heartbeatMs = HEARTBEAT_MS, ...runOptions } = dependencies;
  try {
    const run = await startAgentRun({
      ...runOptions,
      agentId: body.agentId,
      message: body.message,
      model: body.model ?? null,
      projectDir: dirname(projectPath),
    });
    // A second cancel path in case the runtime does not cancel the body when the client leaves.
    if (req.signal.aborted) run.cancel();
    else req.signal.addEventListener("abort", run.cancel, { once: true });
    return new Response(sseStream(run, heartbeatMs), {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AgentRunError) return jsonError(error.status, error.message, error.code);
    return jsonError(500, errorText(error));
  }
}

export async function handleAgentSessionDelete(projectPath: string): Promise<Response> {
  try {
    return await cancelAgentRun(dirname(projectPath))
      ? new Response(null, { status: 204 })
      : jsonError(404, "No agent is running in this project");
  } catch (error) {
    return jsonError(500, errorText(error));
  }
}
