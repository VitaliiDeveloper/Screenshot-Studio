// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConsentStore } from "@web/lib/agents/agent-consent.server.js";
import { AGENT_DEFINITIONS } from "@web/lib/agents/agents.server.js";
import { handleAgentsGet } from "@web/app/api/agents/handler.js";
import { handleAgentConsentPost } from "./handler.js";
import { POST } from "./route.js";

const agy = AGENT_DEFINITIONS.find(({ id }) => id === "agy")!;
const originalDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
const originalPath = process.env.PATH;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-consent-route-"));
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(root, "data");
  process.env.PATH = root;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  if (originalDataRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  else process.env.SCREENSHOT_STUDIO_DATA_ROOT = originalDataRoot;
  await rm(root, { recursive: true, force: true });
});

const post = (body: unknown) => new Request("http://localhost:3000/api/agents/consent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("agent consent", () => {
  it("grants and revokes consent for an at-own-risk agent, and /api/agents reports it at once", async () => {
    const consent = createAgentConsentStore(join(root, "data"));
    const consented = async () => ((await (await handleAgentsGet({ consent })).json()) as {
      agents: { id: string; consented: boolean | null }[];
    }).agents.map(({ id, consented: value }) => [id, value]);

    expect(await consented()).toEqual([["claude-code", null], ["codex", null], ["agy", false], ["gemini-cli", null]]);
    const granted = await handleAgentConsentPost(post({ agentId: "agy", action: "grant" }), { consent });
    expect(await granted.json()).toEqual({ agentId: "agy", consented: true });
    expect(await consent.isGranted(agy)).toBe(true);
    expect((await consented())[2]).toEqual(["agy", true]);

    await handleAgentConsentPost(post({ agentId: "agy", action: "revoke" }), { consent });
    expect(await consent.isGranted(agy)).toBe(false);
    expect((await consented())[2]).toEqual(["agy", false]);
  });

  it("takes no consent for agents that are supported or unavailable, unknown, or malformed", async () => {
    const consent = createAgentConsentStore(join(root, "data"));
    for (const agentId of ["claude-code", "gemini-cli"]) {
      expect((await handleAgentConsentPost(post({ agentId, action: "grant" }), { consent })).status).toBe(409);
    }
    expect((await handleAgentConsentPost(post({ agentId: "nope", action: "grant" }), { consent })).status).toBe(404);
    expect((await handleAgentConsentPost(post({ agentId: "agy", action: "allow" }), { consent })).status).toBe(400);
    expect((await handleAgentConsentPost(new Request("http://localhost/x", { method: "POST", body: "[" }), { consent })).status).toBe(400);
    expect(await access(join(root, "data", "agent-consents.json")).then(() => true, () => false)).toBe(false);
  });

  it("cannot be granted by a blind cross-site POST or from a foreign host", async () => {
    const blind = await POST(new Request("http://localhost:3000/api/agents/consent", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "localhost:3000", origin: "https://evil.example" },
      body: JSON.stringify({ agentId: "agy", action: "grant" }),
    }));
    expect(blind.status).toBeGreaterThanOrEqual(400);

    const rebound = await POST(new Request("http://localhost:3000/api/agents/consent", {
      method: "POST",
      headers: { "content-type": "application/json", host: "rebound.example:3000", "x-project-id": "any" },
      body: JSON.stringify({ agentId: "agy", action: "grant" }),
    }));
    expect(rebound.status).toBe(403);
    expect(await access(join(root, "data", "agent-consents.json")).then(() => true, () => false)).toBe(false);
  });
});
