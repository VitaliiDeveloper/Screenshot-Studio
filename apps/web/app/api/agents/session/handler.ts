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
import {
  attachmentProblem,
  MAX_AGENT_ATTACHMENTS,
  MAX_AGENT_ATTACHMENT_BYTES,
  SNIFF_BYTES,
  sniffAttachmentType,
  type AgentAttachment,
} from "@web/lib/agents/agent-attachments.js";
import { isRecord } from "@web/lib/json-guards.js";

export type AgentSessionDependencies = Pick<AgentRunOptions, "env" | "timeoutMs" | "definitions" | "consent"> & {
  heartbeatMs?: number;
};

const MESSAGE_LIMIT = 20_000;
const HEARTBEAT_MS = 15_000;
// Room for the other form fields and the multipart framing around the image parts.
const BODY_LIMIT = MAX_AGENT_ATTACHMENTS * MAX_AGENT_ATTACHMENT_BYTES + 256 * 1024;

interface SessionInput {
  agentId: unknown;
  message: unknown;
  model: unknown;
  files: unknown[];
}

class InputError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// `formData()` buffers the whole body, so the limit is enforced on the stream before parsing.
async function boundedBody(req: Request): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  for (let next = await reader?.read(); next && !next.done; next = await reader?.read()) {
    size += next.value.byteLength;
    if (size > BODY_LIMIT) {
      await reader?.cancel();
      throw new InputError(413, "The request is too large");
    }
    chunks.push(next.value);
  }
  // Buffer.concat allocates a plain ArrayBuffer; its declared type is wider.
  return Buffer.concat(chunks) as Uint8Array<ArrayBuffer>;
}

/** JSON for a text-only request; multipart when images are attached. */
async function readInput(req: Request): Promise<SessionInput | null> {
  if (req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    const form = await new Response(await boundedBody(req), { headers: { "content-type": req.headers.get("content-type")! } })
      .formData().catch(() => null);
    return form && {
      agentId: form.get("agentId"),
      message: form.get("message"),
      model: form.get("model"),
      files: form.getAll("image"),
    };
  }
  const body: unknown = await req.json().catch(() => null);
  return isRecord(body) ? { agentId: body.agentId, message: body.message, model: body.model, files: [] } : null;
}

/** The bytes decide the type; nothing the client names a file or declares it to be counts. */
async function readAttachments(files: unknown[]): Promise<AgentAttachment[]> {
  if (files.length > MAX_AGENT_ATTACHMENTS) {
    throw new InputError(400, `Attach at most ${MAX_AGENT_ATTACHMENTS} images per request`);
  }
  return Promise.all(files.map(async (file) => {
    if (!(file instanceof Blob)) throw new InputError(400, "image must be a file");
    const problem = attachmentProblem(file.size, new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
    if (problem) throw new InputError(file.size > MAX_AGENT_ATTACHMENT_BYTES ? 413 : 400, problem);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { type: sniffAttachmentType(bytes)!, bytes };
  }));
}

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
  let input: SessionInput | null;
  let attachments: AgentAttachment[];
  try {
    input = await readInput(req);
    attachments = input ? await readAttachments(input.files) : [];
  } catch (error) {
    if (error instanceof InputError) return jsonError(error.status, error.message);
    return jsonError(500, errorText(error));
  }
  if (!input || typeof input.agentId !== "string") {
    return jsonError(400, "request body must be a JSON object or form with an agentId");
  }
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > MESSAGE_LIMIT) {
    return jsonError(400, `message must be non-empty text of at most ${MESSAGE_LIMIT} characters`);
  }
  if (input.model != null && typeof input.model !== "string") return jsonError(400, "model must be a string");
  const { heartbeatMs = HEARTBEAT_MS, ...runOptions } = dependencies;
  try {
    const run = await startAgentRun({
      ...runOptions,
      agentId: input.agentId,
      message: input.message,
      model: input.model ?? null,
      attachments,
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
