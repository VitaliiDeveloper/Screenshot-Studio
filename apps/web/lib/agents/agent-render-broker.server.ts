// SPDX-License-Identifier: Apache-2.0
import type { FileHandle } from "node:fs/promises";
import {
  AgentRenderRequest,
  RENDER_HEARTBEAT_MS,
  type AgentRenderResponse,
} from "@screenshot-studio/core/agent-render";
import { createRenderInbox, type RenderInbox } from "./agent-render-inbox.server.js";
import { runRenderJob, type RenderHost, type RenderJobContext } from "./agent-render-job.server.js";

const POLL_MS = 100;
const MAX_REQUESTS_PER_RUN = 128;
const MAX_QUEUED = 4;
// Fixed: an agent can point a request at a key file, and a parser message would quote it.
const INVALID_REQUEST = "The editor refused this render request.";
const QUEUE_FULL = "The editor is already busy with several renders. Wait for them, then try again.";
const LIMIT_REACHED = `This run reached its limit of ${MAX_REQUESTS_PER_RUN} renders.`;

export interface RenderBroker {
  inboxDir: string;
  /**
   * Cancels and awaits any job that can still publish, then removes the inbox. The run calls this
   * before its verdict, and Undo and project deletion wait for that verdict.
   */
  stop(): Promise<void>;
}

interface QueuedJob {
  id: string;
  request: AgentRenderRequest;
  marker: FileHandle;
}

export interface RenderBrokerOptions {
  projectDir: string;
  host: RenderHost;
  pollMs?: number;
  heartbeatMs?: number;
  maxRequests?: number;
  runJob?: (request: AgentRenderRequest, context: RenderJobContext) => Promise<AgentRenderResponse>;
  createInbox?: () => Promise<RenderInbox>;
}

function parseRequest(bytes: Buffer | null): AgentRenderRequest | null {
  if (!bytes) return null;
  try {
    return AgentRenderRequest.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

/** Starts one run's broker: it answers render requests in the inbox one at a time until stopped. */
export async function startRenderBroker({
  projectDir,
  host,
  pollMs = POLL_MS,
  heartbeatMs = RENDER_HEARTBEAT_MS,
  maxRequests = MAX_REQUESTS_PER_RUN,
  runJob = runRenderJob,
  createInbox = createRenderInbox,
}: RenderBrokerOptions): Promise<RenderBroker> {
  const inbox = await createInbox();
  const seen = new Set<string>();
  const markers = new Set<FileHandle>();
  const queue: QueuedJob[] = [];
  let cancelled = false;
  let listening = true;
  let running: { done: Promise<void>; guardHeld: boolean } | null = null;

  const answer = async (id: string, response: AgentRenderResponse, marker: FileHandle) => {
    // Sent from the job's own failure path too; a file the agent planted costs it only this answer.
    if (!cancelled) await inbox.writeResponse(id, JSON.stringify(response)).catch(() => undefined);
    markers.delete(marker);
    await marker.close().catch(() => undefined);
  };

  const pump = () => {
    if (running || cancelled) return;
    const next = queue.shift();
    if (!next) return;
    const job = { guardHeld: false, done: Promise.resolve() };
    job.done = runJob(next.request, {
      ...host,
      projectDir,
      isCancelled: () => cancelled,
      onGuardHeld: () => { job.guardHeld = true; },
    }).then((response) => answer(next.id, response, next.marker)).catch(() => undefined).finally(() => {
      running = null;
      pump();
    });
    running = job;
  };

  const accept = async (id: string) => {
    seen.add(id);
    // Marked first, so a parallel request queued behind a long bundle does not look unheard.
    const marker = await inbox.createPickedMarker(id).catch(() => null);
    if (!marker) return;
    markers.add(marker);
    const request = parseRequest(await inbox.readRequest(id));
    if (!request) return answer(id, { ok: false, message: INVALID_REQUEST }, marker);
    if (seen.size > maxRequests) return answer(id, { ok: false, message: LIMIT_REACHED }, marker);
    if (queue.length >= MAX_QUEUED) return answer(id, { ok: false, message: QUEUE_FULL }, marker);
    queue.push({ id, request, marker });
    pump();
  };

  const heartbeat = setInterval(() => {
    const now = new Date();
    for (const marker of markers) void marker.utimes(now, now).catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref();

  const stopListening = () => {
    listening = false;
    cancelled = true;
    clearInterval(heartbeat);
  };

  const listen = async () => {
    while (listening) {
      try {
        for (const id of await inbox.newRequestIds(seen)) await accept(id);
      } catch {
        // The folder was swapped or flooded: nothing read from that path can be trusted any more.
        // The stopped heartbeat ends the wait of any CLI still queued.
        stopListening();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };
  const listener = listen();

  let stopping: Promise<void> | null = null;
  return {
    inboxDir: inbox.dir,
    stop() {
      stopping ??= (async () => {
        stopListening();
        await listener;
        // A job still waiting for the guard publishes nothing: it sees the cancel once it gets the
        // guard. Waiting for it here would stall a delete that holds that lock while it stops the run.
        if (running?.guardHeld) await running.done;
        await Promise.all([...markers].map((marker) => marker.close().catch(() => undefined)));
        await inbox.remove();
      })();
      return stopping;
    },
  };
}
