// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { ActiveProjectSelection } from "@web/lib/project-session.js";
import { loadProjectHomeData } from "@web/lib/project-home-client.js";

const selection = {
  sessionId: "session",
  projectId: "project-a",
  name: "Project",
  sourceKind: "managed-project",
  capabilities: {
    writeInPlace: true,
    revealLocation: false,
    watchExternalChanges: false,
    nativePicker: false,
    projectLocalResources: true,
    exportProjectArchive: true,
        deleteProjectPermanently: true,
  },
} satisfies ActiveProjectSelection;

describe("loadProjectHomeData", () => {
  it("establishes the active session before loading validated project resources", async () => {
    const events: string[] = [];
    const resources = {
      project: { meta: { name: "Project" } },
      projectId: "project-a",
      revision: '"revision"',
      images: new Map(),
      specs: {},
      fontWarnings: [],
    } as never;

    await expect(loadProjectHomeData({
      fetchSelection: vi.fn(async () => { events.push("session"); return selection; }),
      loadResources: vi.fn(async () => { events.push("resources"); return resources; }),
    })).resolves.toEqual({ selection, resources });
    expect(events).toEqual(["session", "resources"]);
  });

  it("returns null without loading project resources when no session is active", async () => {
    const loadResources = vi.fn();
    await expect(loadProjectHomeData({
      fetchSelection: vi.fn(async () => null),
      loadResources,
    })).resolves.toBeNull();
    expect(loadResources).not.toHaveBeenCalled();
  });

  it("rejects a stale project response with a different project identity", async () => {
    await expect(loadProjectHomeData({
      fetchSelection: vi.fn(async () => selection),
      loadResources: vi.fn(async () => ({ projectId: "project-b" }) as never),
    })).rejects.toThrow("Active project changed");
  });
});
