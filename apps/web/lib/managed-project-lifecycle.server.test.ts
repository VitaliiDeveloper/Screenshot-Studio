// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectLifecycleService } from "./managed-project-lifecycle.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import { ManagedProjectSourceAdapter, ProjectSessionRegistry } from "./project-session.server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ManagedProjectLifecycleService", () => {
  it("eagerly invalidates the active managed session before Trash returns", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-lifecycle-service-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config);
    const stage = await repository.createStage();
    await writeFile(join(stage.path, "app-store-screenshots.json"), JSON.stringify({
      meta: { name: "Managed", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "primary",
      layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
      }] }],
    }));
    const project = await repository.publishStage({ token: stage.token });
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "managed-session",
      managedSource: new ManagedProjectSourceAdapter(repository),
    });
    const session = await registry.openManaged(project.id);
    const lifecycle = new ManagedProjectLifecycleService(config, registry);

    await expect(lifecycle.moveToTrash(project.id, 1)).resolves.toMatchObject({ lifecycle: "trashed" });
    expect(registry.peek(session.descriptor.sessionId)).toBeUndefined();
  });
});
