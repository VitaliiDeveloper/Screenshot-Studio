// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { ProjectSessionRegistry } from "@web/lib/session/project-session.server.js";
import { CLI_REQUEST_HEADER, handleInstanceOpenPost } from "./handler.js";

const PROJECT_PATH = "/Users/alex/app/screenshots/app-store-screenshots.json";
const registry = {} as ProjectSessionRegistry;

function cliRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:4747/api/instance/open", {
    method: "POST",
    headers: { host: "localhost:4747", "content-type": "application/json", [CLI_REQUEST_HEADER]: "1", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/instance/open", () => {
  it("opens an absolute project path into Recent and returns its entry id", async () => {
    const openLocal = vi.fn(async () => "recent_00000000000000000000000000000001");
    const response = await handleInstanceOpenPost(cliRequest({ projectPath: PROJECT_PATH }), { openLocal }, registry);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ entryId: "recent_00000000000000000000000000000001" });
    expect(openLocal).toHaveBeenCalledWith(PROJECT_PATH, registry);
  });

  it.each([
    ["a browser request (Origin)", { origin: "http://localhost:4747" }],
    ["a request without the CLI header", { [CLI_REQUEST_HEADER]: "" }],
    ["a rebound host name", { host: "attacker.example:4747" }],
  ])("refuses %s before reading the path", async (_case, headers) => {
    const openLocal = vi.fn();
    const response = await handleInstanceOpenPost(cliRequest({ projectPath: PROJECT_PATH }, headers), { openLocal }, registry);

    expect(response.status).toBe(403);
    expect(openLocal).not.toHaveBeenCalled();
  });

  it("accepts the IPv4 and IPv6 loopback host names", async () => {
    const openLocal = vi.fn(async () => "recent_00000000000000000000000000000001");
    for (const host of ["127.0.0.1:4747", "[::1]:4747"]) {
      const response = await handleInstanceOpenPost(cliRequest({ projectPath: PROJECT_PATH }, { host }), { openLocal }, registry);
      expect(response.status).toBe(200);
    }
  });

  it.each([
    ["a relative path", { projectPath: "./app-store-screenshots.json" }],
    ["a missing path", {}],
  ])("rejects %s", async (_case, body) => {
    const response = await handleInstanceOpenPost(cliRequest(body), { openLocal: vi.fn() }, registry);
    expect(response.status).toBe(400);
  });

  it("returns why the project could not be opened", async () => {
    const openLocal = vi.fn(async () => {
      throw new Error("Project file has 2 hard links and cannot have one lock identity");
    });
    const response = await handleInstanceOpenPost(cliRequest({ projectPath: PROJECT_PATH }), { openLocal }, registry);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Project file has 2 hard links and cannot have one lock identity" });
  });
});
