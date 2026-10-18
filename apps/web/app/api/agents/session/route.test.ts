// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import { handleAgentSessionPost } from "./handler.js";
import { DELETE, POST } from "./route.js";

// A fake `claude` on a PATH that holds only the fake directory; the real CLI never runs here.
const SUCCESS_FIXTURE = fileURLToPath(
  new URL("../../../../lib/agents/fixtures/claude-stream-success.ndjson", import.meta.url),
);

let dir: string;
let binDir: string;
let projectPath: string;
const originalPath = process.env.PATH;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-session-route-"));
  binDir = join(dir, "bin");
  await mkdir(binDir);
  projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Agents", schemaVersion: 1 }, fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }] }],
  }));
  process.env.PATH = binDir;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await rm(dir, { recursive: true, force: true });
});

async function fakeClaude(scenario: string): Promise<void> {
  const path = join(binDir, "claude");
  await writeFile(path, `#!/bin/sh
case "$1" in
  --version) echo '2.1.296 (Claude Code)' ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai"}' ;;
  *) echo started > '${dir}/started'; ${scenario} ;;
esac
`);
  await chmod(path, 0o755);
}

// The URL stays loopback, so a rejection can only come from the Host header.
async function sessionRequest(method: string, host = "localhost:3000", body?: unknown): Promise<Request> {
  const session = await projectSessionRegistry.openLocal(projectPath);
  return new Request("http://localhost:3000/api/agents/session", {
    method,
    headers: {
      host,
      cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`,
      "x-project-id": session.projectId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const RUN = { agentId: "claude-code", message: "Add German" };

describe.skipIf(process.platform === "win32")("/api/agents/session", () => {
  it("streams a run as server-sent events for the cookie-selected project", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

    const response = await POST(await sessionRequest("POST", undefined, RUN));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const frames = (await response.text()).split("\n\n").filter(Boolean);
    expect(frames.every((frame) => frame.startsWith("data: "))).toBe(true);
    expect(JSON.parse(frames.at(-1)!.slice(6))).toMatchObject({ type: "done", status: "completed" });
  });

  it("refuses a foreign Host before resolving the project or spawning anything", async () => {
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

    const response = await POST(await sessionRequest("POST", "rebound.example:3000", RUN));

    expect(response.status).toBe(403);
    expect((await DELETE(await sessionRequest("DELETE", "rebound.example"))).status).toBe(403);
    expect(await access(join(dir, "started")).then(() => true, () => false)).toBe(false);
  });

  it("rejects invalid requests with explicit errors", async () => {
    const empty = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify({ agentId: "claude-code", message: " " }),
    }));
    expect(empty.status).toBe(400);

    const unavailable = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify({ agentId: "gemini-cli", message: "Hi" }),
    }));
    expect(unavailable.status).toBe(403);
    expect(await unavailable.json()).toMatchObject({ code: "unavailable" });
  });

  it("cancels the running agent through DELETE", async () => {
    await fakeClaude("exec /bin/sleep 30");
    const response = await POST(await sessionRequest("POST", undefined, RUN));
    expect(response.status).toBe(200);
    await expect.poll(() => access(join(dir, "started")).then(() => true, () => false), { timeout: 5_000 }).toBe(true);

    expect((await DELETE(await sessionRequest("DELETE"))).status).toBe(204);

    expect(await response.text()).toContain('"status":"cancelled"');
    expect((await DELETE(await sessionRequest("DELETE"))).status).toBe(404);
  }, 20_000);
});
