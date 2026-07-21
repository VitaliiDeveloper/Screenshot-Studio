// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import { describe, expect, it, vi } from "vitest";
import { createProjectSaveCoordinator } from "./debounced-save.js";
import {
  advanceProjectDeletionAttempt,
  type ProjectDeletionAttempt,
} from "./project-delete-client.js";
import {
  advanceProjectHomeDeletion,
  type ProjectDeletionAttemptHolder,
} from "./project-deletion-controller.js";
import type { ProjectHomeData } from "./project-home-client.js";

const projectId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const operationId = "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const statusSecret = "2".repeat(64);

function homeData(revision: string): ProjectHomeData {
  return {
    selection: {
      projectId,
      lifecycleRevision: 7,
      capabilities: { deleteProjectPermanently: true },
    },
    resources: {
      revision: `"${revision}"`,
      project: { meta: { name: "Launch Story" } },
    },
  } as unknown as ProjectHomeData;
}

describe("project deletion controller", () => {
  it("waits for an active save and builds the deletion fence from refreshed data", async () => {
    const events: string[] = [];
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const coordinator = createProjectSaveCoordinator(async () => {
      events.push("save:start");
      await saveGate;
      events.push("save:end");
    }, () => ({ meta: { name: "Launch Story" } }) as Project);
    const saving = coordinator.saveLatest();
    await vi.waitFor(() => expect(events).toEqual(["save:start"]));
    const holder: ProjectDeletionAttemptHolder = { attempt: null, inFlight: null };

    const deleting = advanceProjectHomeDeletion({
      current: homeData("1".repeat(64)),
      backup: { kind: "none", acknowledged: true },
      recovering: false,
      holder,
    }, {
      withDrainedSaves: (operation) => coordinator.runExclusive(operation),
      loadData: async () => {
        events.push("load:refreshed");
        return homeData("3".repeat(64));
      },
      createCredentials: () => ({ operationId, statusSecret }),
      advanceAttempt: async (attempt) => {
        events.push(`delete:${attempt.request.projectRevision}`);
        return { kind: "verified" };
      },
    });
    await Promise.resolve();
    expect(events).toEqual(["save:start"]);

    releaseSave();
    await Promise.all([saving, deleting]);
    expect(events).toEqual([
      "save:start",
      "save:end",
      "load:refreshed",
      `delete:${"3".repeat(64)}`,
    ]);
    expect(holder.attempt?.request).toMatchObject({
      projectId,
      projectRevision: "3".repeat(64),
      lifecycleRevision: 7,
      confirmation: "Launch Story",
    });
  });

  it("integrates one admitted delete with status-only recovery and no redispatch", async () => {
    const holder: ProjectDeletionAttemptHolder = { attempt: null, inFlight: null };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ operationId, status: "in-progress" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ status: "expired-or-unknown" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ status: "expired-or-unknown" }, { status: 404 }));
    const dependencies = {
      withDrainedSaves: async <T>(operation: () => Promise<T>) => operation(),
      loadData: async () => homeData("4".repeat(64)),
      createCredentials: () => ({ operationId, statusSecret }),
      advanceAttempt: (attempt: ProjectDeletionAttempt, recovering: boolean) =>
        advanceProjectDeletionAttempt(attempt, recovering, {
          fetcher,
          wait: async () => undefined,
          maxAttempts: 1,
        }),
    };
    const input = {
      current: homeData("1".repeat(64)),
      backup: { kind: "none" as const, acknowledged: true as const },
      holder,
    };

    await expect(advanceProjectHomeDeletion({ ...input, recovering: false }, dependencies))
      .rejects.toThrow(/could not be verified/i);
    expect(holder.attempt?.admitted).toBe(true);
    await expect(advanceProjectHomeDeletion({ ...input, recovering: true }, dependencies))
      .resolves.toEqual({ kind: "unknown-after-admission" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/project-delete",
      "/api/project-delete/operation",
      "/api/project-delete/operation",
    ]);
  });

  it("coalesces concurrent confirmation submits into one deletion operation", async () => {
    const holder: ProjectDeletionAttemptHolder = { attempt: null, inFlight: null };
    let releaseDeletion!: () => void;
    const deletionGate = new Promise<void>((resolve) => { releaseDeletion = resolve; });
    const advanceAttempt = vi.fn(async () => {
      await deletionGate;
      return { kind: "verified" as const };
    });
    const dependencies = {
      withDrainedSaves: async <T>(operation: () => Promise<T>) => operation(),
      loadData: async () => homeData("5".repeat(64)),
      createCredentials: () => ({ operationId, statusSecret }),
      advanceAttempt,
    };
    const input = {
      current: homeData("1".repeat(64)),
      backup: { kind: "none" as const, acknowledged: true as const },
      recovering: false,
      holder,
    };

    const first = advanceProjectHomeDeletion(input, dependencies);
    const second = advanceProjectHomeDeletion(input, dependencies);
    await vi.waitFor(() => expect(advanceAttempt).toHaveBeenCalledOnce());
    releaseDeletion();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "verified" },
      { kind: "verified" },
    ]);
    expect(advanceAttempt).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "changed project identity",
      current: homeData("1".repeat(64)),
      refreshed: {
        ...homeData("2".repeat(64)),
        selection: { ...homeData("2".repeat(64)).selection, projectId: "project_cccccccccccccccccccccccccccccccc" },
      },
      backup: { kind: "none" as const, acknowledged: true as const },
    },
    {
      name: "revoked deletion capability",
      current: homeData("1".repeat(64)),
      refreshed: {
        ...homeData("2".repeat(64)),
        selection: {
          ...homeData("2".repeat(64)).selection,
          capabilities: { deleteProjectPermanently: false },
        },
      },
      backup: { kind: "none" as const, acknowledged: true as const },
    },
    {
      name: "renamed project",
      current: homeData("1".repeat(64)),
      refreshed: {
        ...homeData("2".repeat(64)),
        resources: {
          ...homeData("2".repeat(64)).resources,
          project: { meta: { name: "Renamed" } },
        },
      },
      backup: { kind: "none" as const, acknowledged: true as const },
    },
    {
      name: "invalid lifecycle revision",
      current: homeData("1".repeat(64)),
      refreshed: {
        ...homeData("2".repeat(64)),
        selection: { ...homeData("2".repeat(64)).selection, lifecycleRevision: 0 },
      },
      backup: { kind: "none" as const, acknowledged: true as const },
    },
    {
      name: "stale archive evidence",
      current: homeData("1".repeat(64)),
      refreshed: homeData("2".repeat(64)),
      backup: { kind: "archive" as const, projectRevision: "1".repeat(64) },
    },
  ])("rejects $name before credential generation or deletion", async ({ current, refreshed, backup }) => {
    const createCredentials = vi.fn(() => ({ operationId, statusSecret }));
    const advanceAttempt = vi.fn();
    await expect(advanceProjectHomeDeletion({
      current,
      backup,
      recovering: false,
      holder: { attempt: null, inFlight: null },
    }, {
      withDrainedSaves: async <T>(operation: () => Promise<T>) => operation(),
      loadData: async () => refreshed as ProjectHomeData,
      createCredentials,
      advanceAttempt,
    })).rejects.toThrow();
    expect(createCredentials).not.toHaveBeenCalled();
    expect(advanceAttempt).not.toHaveBeenCalled();
  });
});
