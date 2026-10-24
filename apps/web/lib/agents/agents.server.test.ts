// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS } from "./agents.server.js";

// The VTL-29 spike and its addenda are the source of every level, link and date below.
const EXPECTED = {
  "claude-code": ["supported", "https://code.claude.com/docs/en/legal-and-compliance", "2026-10-15"],
  codex: ["supported", "https://learn.chatgpt.com/codex/app-server", "2026-10-15"],
  copilot: [
    "supported",
    "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#j-ai-features-training-and-your-data",
    "2026-10-20",
  ],
  opencode: ["supported", "https://opencode.ai/docs/go/", "2026-10-24"],
  agy: ["at-own-risk", "https://antigravity.google/terms", "2026-10-15"],
  "gemini-cli": ["unavailable", "https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli", "2026-10-15"],
} as const;

describe("agent policy table", () => {
  it("carries the VTL-29 level, source and check date of every agent", () => {
    expect(AGENT_DEFINITIONS.map(({ id }) => id)).toEqual(Object.keys(EXPECTED));
    for (const { id, policy } of AGENT_DEFINITIONS) {
      expect([policy.level, policy.sourceUrl, policy.checkedAt]).toEqual(EXPECTED[id as keyof typeof EXPECTED]);
      expect(policy.reason.length).toBeGreaterThan(0);
      expect(policy.consequences.length).toBeGreaterThan(0);
    }
  });

  it("offers OpenCode only Go models, so a run never falls back to Zen billing", () => {
    const { models } = AGENT_DEFINITIONS.find(({ id }) => id === "opencode")!;
    expect(models.length).toBeGreaterThan(0);
    for (const { id } of models) expect(id).toMatch(/^opencode-go\/(?!.*free)/);
  });

  it("warns about the account, not only the service, for the at-own-risk agent", () => {
    const { policy } = AGENT_DEFINITIONS.find(({ id }) => id === "agy")!;
    expect(policy.consequences).toMatch(/Antigravity and Gemini CLI accounts restricted or banned/);
  });
});
