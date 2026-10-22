// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import { PUT as putProject } from "@web/app/api/project/route.js";
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
  --help) echo '  --bare    Minimal mode' ;;
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

function started(): Promise<boolean> {
  return access(join(dir, "started")).then(() => true, () => false);
}

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
    expect(await started()).toBe(false);
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

    const unknownModel = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify({ agentId: "codex", message: "Hi", model: "gpt-5.5" }),
    }));
    expect(unknownModel.status).toBe(400);
    expect(await unknownModel.json()).toMatchObject({ code: "unknown-model" });
    expect(await started()).toBe(false);
  });

  it("cancels the run when the request is aborted", async () => {
    await fakeClaude("exec /bin/sleep 30");
    const abort = new AbortController();
    const request = new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify(RUN), signal: abort.signal,
    });
    const response = await handleAgentSessionPost(projectPath, request);
    expect(response.status).toBe(200);
    await expect.poll(started, { timeout: 5_000 }).toBe(true);

    abort.abort();

    expect(await response.text()).toContain('"status":"cancelled"');
    expect((await DELETE(await sessionRequest("DELETE"))).status).toBe(404);
  }, 20_000);

  it("sends keep-alive comments while a run is silent and stops them when it ends", async () => {
    await fakeClaude("exec /bin/sleep 30");
    const response = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify(RUN),
    }), { heartbeatMs: 50 });
    const reader = response.body!.getReader();

    const first = new TextDecoder().decode((await reader.read()).value);

    expect(first).toBe(": keep-alive\n\n");
    await reader.cancel();
    // The slot frees only once the post-run verdict is in, which is asynchronous.
    await expect.poll(async () => (await DELETE(await sessionRequest("DELETE"))).status, { timeout: 5_000 }).toBe(404);

    // A heartbeat left running after `done` would throw on the closed stream as an unhandled error.
    await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
    const finished = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify(RUN),
    }), { heartbeatMs: 10 });
    expect(await finished.text()).toContain('"status":"completed"');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 20_000);

  it("refuses editor saves while the agent runs, then cancels it through DELETE", async () => {
    await fakeClaude("exec /bin/sleep 30");
    const response = await POST(await sessionRequest("POST", undefined, RUN));
    expect(response.status).toBe(200);
    await expect.poll(started, { timeout: 5_000 }).toBe(true);

    const save = await sessionRequest("PUT", undefined, JSON.parse(await readFile(projectPath, "utf8")));
    save.headers.set("if-match", `"${projectRevision(await readFile(projectPath))}"`);
    const refused = await putProject(save);
    expect(refused.status).toBe(423);
    expect(await refused.json()).toMatchObject({ code: "agent-running" });

    expect((await DELETE(await sessionRequest("DELETE"))).status).toBe(204);

    expect(await response.text()).toContain('"status":"cancelled"');
    expect((await DELETE(await sessionRequest("DELETE"))).status).toBe(404);
  }, 20_000);
});
