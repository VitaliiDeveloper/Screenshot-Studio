// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentConsentStore } from "@web/lib/agents/agent-consent.server.js";
import { AGENT_DEFINITIONS, type AgentDefinition } from "@web/lib/agents/agents.server.js";
import { handleAgentsGet } from "@web/app/api/agents/handler.js";
import { handleAgentConsentPost } from "./handler.js";
import { POST } from "./route.js";

const agy = AGENT_DEFINITIONS.find(({ id }) => id === "agy")!;
const originalDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
const originalPath = process.env.PATH;
const originalProjectPath = process.env.PROJECT_PATH;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-consent-route-"));
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(root, "data");
  process.env.PATH = root;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  if (originalProjectPath === undefined) delete process.env.PROJECT_PATH;
  else process.env.PROJECT_PATH = originalProjectPath;
  if (originalDataRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  else process.env.SCREENSHOT_STUDIO_DATA_ROOT = originalDataRoot;
  await rm(root, { recursive: true, force: true });
});

const post = (body: unknown) => new Request("http://localhost:3000/api/agents/consent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const claudeCode = AGENT_DEFINITIONS.find(({ id }) => id === "claude-code")!;
// A stand-in with an adapter: the shipped at-own-risk agent has none, so it takes no grant.
const risky: AgentDefinition = { ...claudeCode, policy: { ...claudeCode.policy, level: "at-own-risk" } };

describe("agent consent", () => {
  it("grants and revokes consent for an at-own-risk agent that can run", async () => {
    const consent = createAgentConsentStore(join(root, "data"));
    const definitions = [risky];

    const granted = await handleAgentConsentPost(post({ agentId: "claude-code", action: "grant" }), { consent, definitions });
    expect(await granted.json()).toEqual({ agentId: "claude-code", consented: true });
    expect(await consent.isGranted(risky)).toBe(true);

    const revoked = await handleAgentConsentPost(post({ agentId: "claude-code", action: "revoke" }), { consent, definitions });
    expect(await revoked.json()).toEqual({ agentId: "claude-code", consented: false });
    expect(await consent.isGranted(risky)).toBe(false);
  });

  it("reports consent in /api/agents outside the registry cache", async () => {
    const consent = createAgentConsentStore(join(root, "data"));
    const consented = async () => ((await (await handleAgentsGet({ consent })).json()) as {
      agents: { id: string; consented: boolean | null }[];
    }).agents.map(({ id, consented: value }) => [id, value]);

    expect(await consented()).toEqual([
      ["claude-code", null], ["codex", null], ["copilot", null], ["opencode", null], ["agy", false], ["gemini-cli", null],
    ]);
    await consent.grant(agy);
    expect((await consented())[4]).toEqual(["agy", true]);
    await consent.revoke("agy");
    expect((await consented())[4]).toEqual(["agy", false]);
  });

  it("refuses a grant for an agent without an adapter, but still lets its consent be revoked", async () => {
    const consent = createAgentConsentStore(join(root, "data"));

    const grant = await handleAgentConsentPost(post({ agentId: "agy", action: "grant" }), { consent });
    expect(grant.status).toBe(409);
    expect(await grant.json()).toMatchObject({ code: "no-adapter" });
    expect(await access(join(root, "data", "agent-consents.json")).then(() => true, () => false)).toBe(false);

    await consent.grant(agy);
    expect((await handleAgentConsentPost(post({ agentId: "agy", action: "revoke" }), { consent })).status).toBe(200);
    expect(await consent.isGranted(agy)).toBe(false);
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
    // With an active project the only thing left to refuse a blind POST is its missing X-Project-Id.
    await cp(fileURLToPath(new URL("../../../../../../fixtures/sample", import.meta.url)), join(root, "project"), { recursive: true });
    process.env.PROJECT_PATH = join(root, "project", "app-store-screenshots.json");
    const blind = await POST(new Request("http://localhost:3000/api/agents/consent", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "localhost:3000", origin: "https://evil.example" },
      body: JSON.stringify({ agentId: "claude-code", action: "grant" }),
    }));
    expect(blind.status).toBe(428);

    const rebound = await POST(new Request("http://localhost:3000/api/agents/consent", {
      method: "POST",
      headers: { "content-type": "application/json", host: "rebound.example:3000", "x-project-id": "any" },
      body: JSON.stringify({ agentId: "claude-code", action: "grant" }),
    }));
    expect(rebound.status).toBe(403);
    expect(await access(join(root, "data", "agent-consents.json")).then(() => true, () => false)).toBe(false);
  });
});
