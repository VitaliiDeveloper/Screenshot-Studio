// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { errorText } from "@screenshot-studio/core/storage";
import { jsonError } from "@web/lib/api-error-response.server.js";
import {
  AgentRunError,
  cancelAgentRun,
  startAgentRun,
  type AgentEvent,
  type AgentRunOptions,
} from "@web/lib/agents/agent-session.server.js";
import { isRecord } from "@web/lib/json-guards.js";

export type AgentSessionDependencies = Pick<AgentRunOptions, "env" | "timeoutMs" | "definitions">;

const MESSAGE_LIMIT = 20_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** DNS rebinding reaches the loopback server under a foreign Host; agent runs refuse those. */
export function isLoopbackRequest(req: Request): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${req.headers.get("host") ?? new URL(req.url).host}`).hostname);
  } catch {
    return false;
  }
}

function sseStream(events: ReadableStream<AgentEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return events.pipeThrough(new TransformStream<AgentEvent, Uint8Array>({
    transform(event, controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
  }));
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
  try {
    const run = await startAgentRun({
      ...dependencies,
      agentId: body.agentId,
      message: body.message,
      model: body.model ?? null,
      projectDir: dirname(projectPath),
    });
    return new Response(sseStream(run.events), {
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
