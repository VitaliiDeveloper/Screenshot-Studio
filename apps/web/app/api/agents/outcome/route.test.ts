// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "@screenshot-studio/core/model";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import { POST as startRun } from "@web/app/api/agents/session/route.js";
import { GET, POST } from "./route.js";

// A fake `claude` on a PATH that holds only the fake directory; it rewrites the project and exits.
const SUCCESS_FIXTURE = fileURLToPath(
  new URL("../../../../lib/agents/fixtures/claude-stream-success.ndjson", import.meta.url),
);

const PROJECT = {
  meta: { name: "Agents", schemaVersion: 1 }, fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }] }],
};
const CHANGED = { ...PROJECT, meta: { ...PROJECT.meta, name: "Agents DE" } };

let dir: string;
let projectPath: string;
const originalPath = process.env.PATH;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-outcome-route-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify(PROJECT));
  await writeFile(join(dir, "changed.json"), JSON.stringify(CHANGED));
  const fake = join(binDir, "claude");
  await writeFile(fake, `#!/bin/sh
case "$1" in
  --version) echo '2.1.296 (Claude Code)' ;;
  --help) echo '  --bare    Minimal mode' ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai"}' ;;
  *) /bin/cp '${dir}/changed.json' app-store-screenshots.json; /bin/cat '${SUCCESS_FIXTURE}' ;;
esac
`);
  await chmod(fake, 0o755);
  process.env.PATH = binDir;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await rm(dir, { recursive: true, force: true });
});

async function request(path: string, method: string, body?: unknown, host = "localhost:3000"): Promise<Request> {
  const session = await projectSessionRegistry.openLocal(projectPath);
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      host,
      cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`,
      "x-project-id": session.projectId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(process.platform === "win32")("/api/agents/outcome", () => {
  it("offers Undo run for an accepted change and restores the snapshot", async () => {
    expect(await (await GET(await request("/api/agents/outcome", "GET"))).json()).toEqual({ outcome: null });

    const run = await startRun(await request("/api/agents/session", "POST", { agentId: "claude-code", message: "Rename" }));
    expect(await run.text()).toContain('"status":"accepted"');
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual(CHANGED);
    const pending = await (await GET(await request("/api/agents/outcome", "GET"))).json();
    expect(pending.outcome).toMatchObject({ revision: expect.any(String), changedScreens: [], otherFiles: { files: [], count: 0 } });

    const undone = await POST(await request("/api/agents/outcome", "POST", { action: "undo" }));
    expect(undone.status).toBe(200);
    expect(await undone.json()).toEqual({ restored: true, outcome: pending.outcome });
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual(parseProject(PROJECT));
    expect((await POST(await request("/api/agents/outcome", "POST", { action: "undo" }))).status).toBe(404);
  });

  it("keeps a change, validates the action, and refuses a foreign Host", async () => {
    await (await startRun(await request("/api/agents/session", "POST", { agentId: "claude-code", message: "Rename" }))).text();

    expect((await POST(await request("/api/agents/outcome", "POST", { action: "keep" }))).status).toBe(204);
    expect((await POST(await request("/api/agents/outcome", "POST", { action: "keep" }))).status).toBe(404);
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual(CHANGED);
    expect((await POST(await request("/api/agents/outcome", "POST", { action: "drop" }))).status).toBe(400);
    expect((await GET(await request("/api/agents/outcome", "GET", undefined, "rebound.example"))).status).toBe(403);
  });
});
