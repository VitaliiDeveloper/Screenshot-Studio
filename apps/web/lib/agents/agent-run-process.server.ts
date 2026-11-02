// SPDX-License-Identifier: Apache-2.0
import { errorText } from "@screenshot-studio/core/storage";
import {
  killProcessTree,
  spawnAgentProcess,
  type AgentDefinition,
} from "./agents.server.js";
import { boundedEvent, readBoundedLines } from "./agent-output-limits.server.js";
import type { SettledRun } from "./agent-run-verdict.server.js";
import type {
  AgentAdapter,
  AgentDoneStatus,
  AgentEvent,
  AgentRun,
  AgentRunRequest,
} from "./agent-session.server.js";

const STDERR_LIMIT = 64 * 1024;

export function launchRun(
  definition: AgentDefinition,
  adapter: AgentAdapter,
  request: AgentRunRequest,
  options: {
    projectDir: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    settle: (status: AgentDoneStatus) => Promise<SettledRun>;
    release: () => void;
  },
): AgentRun {
  const normalizer = adapter.normalizer();
  let controller!: ReadableStreamDefaultController<AgentEvent>;
  let streamOpen = true;
  let ended = false;
  let stderr = "";

  const events = new ReadableStream<AgentEvent>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      streamOpen = false;
      cancel();
    },
  });
  const child = spawnAgentProcess(definition.binary, adapter.args(request), {
    cwd: options.projectDir,
    env: { ...options.env, ...adapter.env?.(request) },
    input: adapter.input?.(request) ?? request.message,
  });

  function close(next: AgentEvent[]): void {
    if (streamOpen) {
      for (const event of next) controller.enqueue(event);
    }
    // The project slot stays taken until the verdict is in, so no second run starts on an unchecked file.
    options.release();
    if (streamOpen) controller.close();
    streamOpen = false;
  }

  async function finish(done: Extract<AgentEvent, { type: "done" }>): Promise<void> {
    try {
      const settled = await options.settle(done.status);
      close([settled.result, { ...done, status: settled.status }]);
    } catch (error) {
      close([
        { type: "error", code: "failed", message: `The project could not be verified after the run: ${errorText(error)}`, resets: null },
        { ...done, status: "failed" },
      ]);
    }
  }

  function emit(next: AgentEvent[]): void {
    for (const event of next) {
      if (ended) return;
      if (event.type !== "done") {
        if (streamOpen) controller.enqueue(boundedEvent(event));
        continue;
      }
      ended = true;
      clearTimeout(timer);
      // Also reaps anything the agent left running: no background work outlives a run, and the
      // verdict below reads a file nothing is still writing.
      killProcessTree(child);
      void finish(event);
    }
  }
  function cancel(): void {
    emit([{ type: "done", status: "cancelled", summary: null, durationMs: null }]);
  }

  const timer = setTimeout(() => emit([
    { type: "error", code: "timeout", message: "The agent run timed out", resets: null },
    { type: "done", status: "failed", summary: null, durationMs: null },
  ]), options.timeoutMs);
  if (child.stdout) readBoundedLines(child.stdout, (line) => emit(normalizer.line(line)));
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
  });
  child.once("error", () => emit(normalizer.end({ code: null, stderr })));
  child.once("close", (code) => emit(normalizer.end({ code, stderr })));
  return { events, cancel };
}
