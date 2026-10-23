// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConsentStore } from "./agent-consent.server.js";
import { AGENT_DEFINITIONS } from "./agents.server.js";

const agy = AGENT_DEFINITIONS.find(({ id }) => id === "agy")!;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-consent-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("agent consent store", () => {
  it("has no consent until it is granted, keeps it across stores, and drops it on revoke", async () => {
    const store = createAgentConsentStore(join(root, "data"));
    expect(await store.isGranted(agy)).toBe(false);

    await store.grant(agy);
    expect(await store.isGranted(agy)).toBe(true);
    expect(await createAgentConsentStore(join(root, "data")).isGranted(agy)).toBe(true);

    await store.revoke(agy.id);
    expect(await createAgentConsentStore(join(root, "data")).isGranted(agy)).toBe(false);
  });

  it("writes one private document and leaves no stage files behind", async () => {
    const store = createAgentConsentStore(join(root, "data"));
    await Promise.all([store.grant(agy), store.grant({ ...agy, id: "other" })]);

    expect((await readdir(join(root, "data")))).toEqual(["agent-consents.json"]);
    expect((await stat(join(root, "data", "agent-consents.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(root, "data", "agent-consents.json"), "utf8")).consents)
      .toEqual({
        agy: { policyCheckedAt: agy.policy.checkedAt, grantedAt: expect.any(String) },
        other: { policyCheckedAt: agy.policy.checkedAt, grantedAt: expect.any(String) },
      });
  });

  it("ignores consent bound to an older policy check", async () => {
    const store = createAgentConsentStore(join(root, "data"));
    await store.grant({ ...agy, policy: { ...agy.policy, checkedAt: "2026-01-01" } });

    expect(await store.isGranted(agy)).toBe(false);
  });
});
