// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const RUN = { agentId: "claude-code", message: "Add German", model: "claude-haiku-5-5", effort: "low" };

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// Built like the browser's FormData upload: the multipart content type carries the boundary.
async function attachedRequest(
  files: Array<{ name: string; type: string; bytes: Uint8Array<ArrayBuffer> }>,
  { host = "localhost:3000", projectId = true }: { host?: string; projectId?: boolean } = {},
): Promise<Request> {
  const session = await projectSessionRegistry.openLocal(projectPath);
  const form = new FormData();
  for (const [key, value] of Object.entries(RUN)) form.set(key, value);
  for (const file of files) form.append("image", new File([file.bytes], file.name, { type: file.type }));
  const encoded = new Response(form);
  const headers = new Headers({
    host,
    cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`,
    "content-type": encoded.headers.get("content-type")!,
  });
  if (projectId) headers.set("x-project-id", session.projectId);
  return new Request("http://localhost:3000/api/agents/session", { method: "POST", headers, body: await encoded.arrayBuffer() });
}

const png = (name = "ref.png") => ({ name, type: "image/png", bytes: PNG_BYTES });

function started(): Promise<boolean> {
  return access(join(dir, "started")).then(() => true, () => false);
}

describe.skipIf(process.platform === "win32")("/api/agents/session", () => {
  it("streams a run as server-sent events for the cookie-selected project", async () => {
    await fakeClaude(`printf '%s\\n' "$@" > '${dir}/argv'; /bin/cat '${SUCCESS_FIXTURE}'`);

    const response = await POST(await sessionRequest("POST", undefined, RUN));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const frames = (await response.text()).split("\n\n").filter(Boolean);
    expect(frames.every((frame) => frame.startsWith("data: "))).toBe(true);
    expect(JSON.parse(frames.at(-1)!.slice(6))).toMatchObject({ type: "done", status: "completed" });
    const argv = (await readFile(join(dir, "argv"), "utf8")).split("\n");
    expect(argv).toEqual(expect.arrayContaining(["--model", "claude-haiku-5-5", "--effort", "low"]));
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

    const effortType = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify({ agentId: "claude-code", message: "Hi", effort: 3 }),
    }));
    expect(effortType.status).toBe(400);
    const unknownEffort = await handleAgentSessionPost(projectPath, new Request("http://localhost/api/agents/session", {
      method: "POST", body: JSON.stringify({ agentId: "codex", message: "Hi", effort: "high" }),
    }));
    expect(unknownEffort.status).toBe(400);
    expect(await unknownEffort.json()).toMatchObject({ code: "unknown-effort" });
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

  describe("image attachments", () => {
    it("streams a run that received the images and leaves no trace in the project folder", async () => {
      await fakeClaude(`printf '%s\\n' "$@" > '${dir}/argv'; /bin/cat '${SUCCESS_FIXTURE}'`);

      const response = await POST(await attachedRequest([png(), png("second.png")]));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"status":"completed"');
      const argv = (await readFile(join(dir, "argv"), "utf8")).split("\n");
      expect(argv.filter((_, index) => argv[index - 1] === "--add-dir").some((value) => /run-/.test(value))).toBe(true);
      expect(argv).toEqual(expect.arrayContaining(["--model", "claude-haiku-5-5", "--effort", "low"]));
      expect((await readdir(dir)).sort()).toEqual(["app-store-screenshots.json", "argv", "bin", "started"]);
      expect(await readFile(projectPath, "utf8")).not.toMatch(/\.png|attachment/i);
    });

    it("decides the type by the bytes: a text file renamed .png is refused before any run", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
      const disguised = { name: "ref.png", type: "image/png", bytes: new TextEncoder().encode("<svg onload=alert(1)/>") };

      const response = await POST(await attachedRequest([disguised]));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/PNG, JPEG and WebP/);
      expect(await started()).toBe(false);
    });

    it("refuses an empty image and an image part that is not a file", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

      const empty = await POST(await attachedRequest([{ name: "empty.png", type: "image/png", bytes: new Uint8Array() }]));
      expect(empty.status).toBe(400);
      expect((await empty.json()).error).toMatch(/empty/);

      const request = await attachedRequest([]);
      const form = new FormData();
      form.set("agentId", RUN.agentId);
      form.set("message", RUN.message);
      form.set("image", "not a file");
      const encoded = new Response(form);
      const headers = new Headers(request.headers);
      headers.set("content-type", encoded.headers.get("content-type")!);
      const text = await POST(new Request(request.url, { method: "POST", headers, body: await encoded.arrayBuffer() }));
      expect(text.status).toBe(400);
      expect(await started()).toBe(false);
    });

    it("accepts a real image under a misleading name and type", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

      const response = await POST(await attachedRequest([{ name: "notes.txt", type: "text/plain", bytes: PNG_BYTES }]));

      expect(response.status).toBe(200);
      await response.text();
    });

    it("limits the number and the size of the images", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

      const tooMany = await POST(await attachedRequest(Array.from({ length: 6 }, () => png())));
      expect(tooMany.status).toBe(400);
      expect((await tooMany.json()).error).toMatch(/at most 5/);

      const big = new Uint8Array(10 * 1024 * 1024 + 1);
      big.set(PNG_BYTES);
      const tooLarge = await POST(await attachedRequest([{ name: "big.png", type: "image/png", bytes: big }]));
      expect(tooLarge.status).toBe(413);

      const atLimit = new Uint8Array(10 * 1024 * 1024);
      atLimit.set(PNG_BYTES);
      const accepted = await POST(await attachedRequest([{ name: "edge.png", type: "image/png", bytes: atLimit }]));
      expect(accepted.status).toBe(200);
      await accepted.text();
    }, 30_000);

    it("stops reading a body that is larger than every allowed upload together", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);
      const huge = new Uint8Array(5 * 10 * 1024 * 1024 + 512 * 1024);
      huge.set(PNG_BYTES);

      const response = await POST(await attachedRequest([{ name: "huge.png", type: "image/png", bytes: huge }]));

      expect(response.status).toBe(413);
      expect(await started()).toBe(false);
    }, 30_000);

    it("refuses a foreign Host and a missing X-Project-Id before reading the images", async () => {
      await fakeClaude(`/bin/cat '${SUCCESS_FIXTURE}'`);

      expect((await POST(await attachedRequest([png()], { host: "rebound.example:3000" }))).status).toBe(403);
      const noProject = await POST(await attachedRequest([png()], { projectId: false }));
      expect(noProject.status).toBe(428);
      expect(await started()).toBe(false);
    });
  });
});
