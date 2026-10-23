// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS } from "./agents.server.js";

// The VTL-29 spike (checked 15 Oct 2026) is the source of every level, link and date below.
const EXPECTED = {
  "claude-code": ["supported", "https://code.claude.com/docs/en/legal-and-compliance"],
  codex: ["supported", "https://learn.chatgpt.com/codex/app-server"],
  agy: ["at-own-risk", "https://antigravity.google/terms"],
  "gemini-cli": ["unavailable", "https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli"],
} as const;

describe("agent policy table", () => {
  it("carries the VTL-29 level, source and check date of every agent", () => {
    expect(AGENT_DEFINITIONS.map(({ id }) => id)).toEqual(Object.keys(EXPECTED));
    for (const { id, policy } of AGENT_DEFINITIONS) {
      expect([policy.level, policy.sourceUrl]).toEqual(EXPECTED[id as keyof typeof EXPECTED]);
      expect(policy.checkedAt).toBe("2026-10-15");
      expect(policy.reason.length).toBeGreaterThan(0);
      expect(policy.consequences.length).toBeGreaterThan(0);
    }
  });

  it("warns about the account, not only the service, for the at-own-risk agent", () => {
    const { policy } = AGENT_DEFINITIONS.find(({ id }) => id === "agy")!;
    expect(policy.consequences).toMatch(/Antigravity and Gemini CLI accounts restricted or banned/);
  });
});
