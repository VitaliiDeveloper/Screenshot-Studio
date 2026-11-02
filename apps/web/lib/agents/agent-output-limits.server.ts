// SPDX-License-Identifier: Apache-2.0
import type { Readable } from "node:stream";
import type { AgentEvent } from "./agent-session.server.js";

// Far above any line an adapter reads; Claude's base64 image reads are larger, but ignored anyway.
export const OUTPUT_LINE_LIMIT = 1024 * 1024;
export const EVENT_TEXT_LIMIT = 16_000;
export const TRUNCATED_MARKER = " … [truncated]";

/**
 * Calls `onLine` for each line of `input` without its line ending. A line longer than
 * `OUTPUT_LINE_LIMIT` is dropped, like a malformed one, and never buffered whole.
 */
export function readBoundedLines(input: Readable, onLine: (line: string) => void): void {
  let pending = "";
  let dropping = false;
  input.setEncoding("utf8").on("data", (chunk: string) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!dropping && line.length <= OUTPUT_LINE_LIMIT) onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      dropping = false;
    }
    if (pending.length > OUTPUT_LINE_LIMIT) {
      pending = "";
      dropping = true;
    }
  });
  input.on("end", () => {
    if (pending && !dropping) onLine(pending);
  });
}

function clip(value: string): string {
  return value.length > EVENT_TEXT_LIMIT ? `${value.slice(0, EVENT_TEXT_LIMIT)}${TRUNCATED_MARKER}` : value;
}

/** Caps the agent-written text an event carries to the client. */
export function boundedEvent(event: AgentEvent): AgentEvent {
  if (event.type === "text") return { ...event, text: clip(event.text) };
  if (event.type === "tool-use") {
    return { ...event, command: event.command && clip(event.command), path: event.path && clip(event.path) };
  }
  return event;
}
