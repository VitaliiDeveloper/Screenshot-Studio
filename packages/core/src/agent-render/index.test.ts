// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { AgentRenderRequest, renderRequestId } from "./index.js";

const ID = "01234567-89ab-4def-8123-456789abcdef";

describe("agent render protocol", () => {
  it("accepts only the flags an agent may choose", () => {
    expect(AgentRenderRequest.safeParse({
      command: "export",
      flags: { screen: "a", size: "b", layout: "c", locale: "d", platform: "e", device: "f", profile: "g" },
    }).success).toBe(true);
    expect(AgentRenderRequest.safeParse({
      command: "check",
      flags: { render: true, json: true, strict: true, layout: "c" },
    }).success).toBe(true);
    for (const flag of ["project", "out", "browser", "store-specs", "headless"]) {
      expect(AgentRenderRequest.safeParse({ command: "export", flags: { [flag]: "/x" } }).success, flag).toBe(false);
      expect(AgentRenderRequest.safeParse({ command: "check", flags: { render: true, [flag]: "/x" } }).success, flag).toBe(false);
    }
  });

  it("never routes another command, or a check that does not render", () => {
    expect(AgentRenderRequest.safeParse({ command: "upload", flags: {} }).success).toBe(false);
    expect(AgentRenderRequest.safeParse({ command: "check", flags: {} }).success).toBe(false);
    expect(AgentRenderRequest.safeParse({ command: "export", flags: {}, extra: 1 }).success).toBe(false);
  });

  it("recognizes only exact request file names", () => {
    expect(renderRequestId(`request-${ID}.json`)).toBe(ID);
    for (const name of [`request-${ID}.json.tmp`, `.request-${ID}.json`, `request-${ID.toUpperCase()}.json`, "request-1.json", `picked-${ID}`, `../request-${ID}.json`]) {
      expect(renderRequestId(name), name).toBeNull();
    }
  });
});
