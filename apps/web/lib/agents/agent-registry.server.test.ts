// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectAgent, listAgentStatuses } from "./agent-registry.server.js";
import { AGENT_DEFINITIONS } from "./agents.server.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const claude = AGENT_DEFINITIONS.find(({ id }) => id === "claude-code")!;

describe("agent detection per platform", () => {
  let emptyPath: string;
  const env = (): NodeJS.ProcessEnv => ({ NODE_ENV: "test", PATH: emptyPath });

  beforeEach(async () => {
    emptyPath = await mkdtemp(join(tmpdir(), "agent-registry-"));
    vi.mocked(spawn).mockClear();
  });

  afterEach(async () => {
    await rm(emptyPath, { recursive: true, force: true });
  });

  it("reports Windows as unsupported without starting any CLI", async () => {
    const status = await detectAgent(claude, { env: env(), codexAuthStore: null, platform: "win32" });

    expect(status).toMatchObject({ id: "claude-code", installed: null, version: null, state: "unsupported-platform" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("probes the CLI on other platforms, where a missing binary reads as not installed", async () => {
    const status = await detectAgent(claude, { env: env(), codexAuthStore: null, platform: "linux" });

    expect(status).toMatchObject({ installed: false, state: "not-installed" });
    expect(spawn).toHaveBeenCalled();
  });

  it("keeps policy states on Windows and does not share cached statuses across platforms", async () => {
    const options = { env: env(), codexAuthStore: null };
    const states = async (platform: NodeJS.Platform) =>
      (await listAgentStatuses({ ...options, platform })).map(({ id, state }) => [id, state]);

    expect(await states("linux")).toEqual([
      ["claude-code", "not-installed"], ["codex", "not-installed"], ["copilot", "not-installed"],
      ["opencode", "not-installed"], ["agy", "no-adapter"], ["gemini-cli", "unavailable"],
    ]);
    vi.mocked(spawn).mockClear();
    expect(await states("win32")).toEqual([
      ["claude-code", "unsupported-platform"], ["codex", "unsupported-platform"],
      ["copilot", "unsupported-platform"], ["opencode", "unsupported-platform"], ["agy", "no-adapter"], ["gemini-cli", "unavailable"],
    ]);
    expect(spawn).not.toHaveBeenCalled();
  });
});
