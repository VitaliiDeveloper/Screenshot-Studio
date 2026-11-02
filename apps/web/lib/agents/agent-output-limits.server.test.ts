// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import {
  boundedEvent,
  EVENT_TEXT_LIMIT,
  OUTPUT_LINE_LIMIT,
  readBoundedLines,
  TRUNCATED_MARKER,
} from "./agent-output-limits.server.js";

async function lines(chunks: string[]): Promise<string[]> {
  const input = new PassThrough();
  const read: string[] = [];
  readBoundedLines(input, (line) => read.push(line));
  for (const chunk of chunks) input.write(chunk);
  input.end();
  await finished(input);
  return read;
}

describe("agent output limits", () => {
  it("splits lines across chunks, drops CRLF endings, and keeps a last line without a newline", async () => {
    expect(await lines(['{"a":', '1}\r\n{"b"', ":2}\n", "tail"])).toEqual(['{"a":1}', '{"b":2}', "tail"]);
  });

  it("drops a line over the limit without buffering it, whole or split across chunks", async () => {
    const long = "x".repeat(OUTPUT_LINE_LIMIT + 1);
    const half = "y".repeat(OUTPUT_LINE_LIMIT / 2 + 1);

    expect(await lines(["before\n", `${long}\nafter\n`])).toEqual(["before", "after"]);
    expect(await lines(["before\n", half, half, half, "\nafter"])).toEqual(["before", "after"]);
    expect(await lines([long])).toEqual([]);
  });

  it("truncates event text, commands, and paths with a visible marker", () => {
    const long = "z".repeat(EVENT_TEXT_LIMIT + 5);
    const clipped = `${"z".repeat(EVENT_TEXT_LIMIT)}${TRUNCATED_MARKER}`;

    expect(boundedEvent({ type: "text", text: long })).toEqual({ type: "text", text: clipped });
    expect(boundedEvent({ type: "tool-use", tool: "Bash", command: long, path: long }))
      .toEqual({ type: "tool-use", tool: "Bash", command: clipped, path: clipped });
    expect(boundedEvent({ type: "tool-use", tool: "Read", command: null, path: "AGENTS.md" }))
      .toEqual({ type: "tool-use", tool: "Read", command: null, path: "AGENTS.md" });
  });
});
