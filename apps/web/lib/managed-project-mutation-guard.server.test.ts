// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { acquireManagedProjectLifecycleLock } from "@web/lib/managed-project-lifecycle-lock.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import { withManagedProjectMutationGuard } from "@web/lib/managed-project-mutation-guard.server.js";
import type { ProjectSession } from "@web/lib/project-session.server.js";

const roots: string[] = [];

function validProjectJson() {
  return JSON.stringify({
    meta: { name: "Guarded", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
    }] }],
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("withManagedProjectMutationGuard", () => {
  it("rejects stale sessions and excludes mutations while a lifecycle owner is active", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-mutation-guard-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config);
    const stage = await repository.createStage();
    await writeFile(join(stage.path, "app-store-screenshots.json"), validProjectJson());
    const project = await repository.publishStage({ token: stage.token });
    const session = {
      descriptor: { sessionId: "session", name: project.name, sourceKind: "managed-project", lifecycleRevision: 1, capabilities: {} },
      projectId: project.id,
      projectPath: project.projectPath,
    } as ProjectSession;
    const owner = await acquireManagedProjectLifecycleLock(config, project.id, {
      timeoutMs: 0, staleAfterMs: 5_000, retryDelayMs: 10, heartbeatMs: 1_000,
    });
    const operation = vi.fn(async () => "mutated");

    await expect(withManagedProjectMutationGuard(session, operation, {
      config,
      lockOptions: { timeoutMs: 0, staleAfterMs: 5_000, retryDelayMs: 10, heartbeatMs: 1_000 },
    })).rejects.toThrow(/lifecycle lock/i);
    expect(operation).not.toHaveBeenCalled();
    await owner.release();

    session.descriptor.lifecycleRevision = 2;
    await expect(withManagedProjectMutationGuard(session, operation, { config }))
      .rejects.toThrow(/lifecycle changed/i);
    expect(operation).not.toHaveBeenCalled();
  });
});
