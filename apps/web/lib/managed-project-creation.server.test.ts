// SPDX-License-Identifier: Apache-2.0
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { createProjectScaffold } from "@screenshot-studio/core/scaffold";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import { ManagedProjectCreationService } from "./managed-project-creation.server.js";

const roots: string[] = [];
const specs = parseStoreSpecs({
  apple: { iphone: [{ id: "lead", label: "Apple lead", width: 1320, height: 2868, orientation: "portrait" }] },
  android: { phone: [{ id: "lead", label: "Android lead", width: 1080, height: 1920, orientation: "portrait" }] },
  windows: { desktop: [{ id: "lead", label: "Windows lead", width: 1920, height: 1080, orientation: "landscape" }] },
});

async function repository(dependencies: ConstructorParameters<typeof ManagedProjectRepository>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), "managed-project-creation-"));
  roots.push(root);
  return new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100000",
  }), dependencies);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ManagedProjectCreationService", () => {
  it("creates empty and starter-template projects through one managed publication path", async () => {
    const managed = await repository();
    const service = new ManagedProjectCreationService(managed, { storeSpecs: specs });

    const empty = await service.create({
      name: "Empty", platform: "windows", layoutMode: "connected", templateId: null,
    });
    const starter = await service.create({
      name: "Starter", platform: "android", layoutMode: "isolated", templateId: "product-launch",
    });

    expect(empty.id).not.toBe(starter.id);
    expect((await managed.list()).map(({ name }) => name).sort()).toEqual(["Empty", "Starter"]);
    const emptyProject = JSON.parse(await readFile(empty.projectPath, "utf8")) as {
      layouts: Array<{ mode: string; screens: Array<{ platform: string }> }>;
    };
    const starterProject = JSON.parse(await readFile(starter.projectPath, "utf8")) as {
      layouts: Array<{ screens: unknown[] }>;
    };
    expect(emptyProject.layouts[0]).toMatchObject({ mode: "connected", screens: [{ platform: "windows" }] });
    expect(starterProject.layouts[0]!.screens).toHaveLength(3);
  });

  it("publishes a prevalidated scaffold through the same managed stage path", async () => {
    const managed = await repository();
    const service = new ManagedProjectCreationService(managed, { storeSpecs: specs });
    const input = {
      name: "Prepared", platform: "apple", layoutMode: "isolated", templateId: null,
    } as const;
    const scaffold = await service.buildScaffold(input);
    scaffold.project.meta.name = "Prepared exact";

    const record = await service.createFromValidatedScaffold(scaffold);

    expect(JSON.parse(await readFile(record.projectPath, "utf8"))).toMatchObject({
      meta: { name: "Prepared exact" },
    });
    await expect(managed.list()).resolves.toHaveLength(1);
  });

  it("validates generated dependencies before allocating a managed stage", async () => {
    const managed = await repository();
    const createStage = vi.spyOn(managed, "createStage");
    const service = new ManagedProjectCreationService(managed, {
      storeSpecs: specs,
      createScaffold(input, inputSpecs) {
        const scaffold = createProjectScaffold(input, inputSpecs);
        scaffold.project.layouts[0]!.screens[0]!.elements.push({
          id: "missing", type: "image", x: 0, y: 0, width: 10, height: 10,
          rotation: 0, opacity: 1, locked: false, visible: true,
          assetUrl: "assets/missing.png", fit: "contain", cornerRadius: 0,
        });
        return scaffold;
      },
    });

    await expect(service.create({
      name: "Invalid", platform: "apple", layoutMode: "isolated", templateId: null,
    })).rejects.toThrow(/missing.*assets\/missing\.png/i);
    expect(createStage).not.toHaveBeenCalled();
    await expect(managed.list()).resolves.toEqual([]);
  });

  it("discards the exact owned stage when an exclusive file write fails", async () => {
    const managed = await repository();
    const service = new ManagedProjectCreationService(managed, {
      storeSpecs: specs,
      writeStageFile: async () => { throw new Error("injected stage write failure"); },
    });

    await expect(service.create({
      name: "Write failure", platform: "apple", layoutMode: "isolated", templateId: null,
    })).rejects.toThrow("injected stage write failure");
    await expect(managed.list()).resolves.toEqual([]);
    await expect(readdir(managed.config.stagingRoot)).resolves.toEqual([]);
  });

  it("revalidates staged dependencies before publication", async () => {
    const managed = await repository();
    const service = new ManagedProjectCreationService(managed, {
      storeSpecs: specs,
      createScaffold(input, inputSpecs) {
        const scaffold = createProjectScaffold(input, inputSpecs);
        scaffold.project.layouts[0]!.screens[0]!.elements.push({
          id: "required", type: "image", x: 0, y: 0, width: 10, height: 10,
          rotation: 0, opacity: 1, locked: false, visible: true,
          assetUrl: "assets/required.png", fit: "contain", cornerRadius: 0,
        });
        scaffold.resources.push({
          path: "assets/required.png",
          bytes: new Uint8Array([1, 2, 3]),
        });
        return scaffold;
      },
      async writeStageFile(stagePath, file) {
        if (file.path === "app-store-screenshots.json") {
          await writeFile(join(stagePath, file.path), file.bytes);
        }
      },
    });

    await expect(service.create({
      name: "Missing staged dependency", platform: "apple", layoutMode: "isolated", templateId: null,
    })).rejects.toThrow(/required\.png|ENOENT/i);
    await expect(managed.list()).resolves.toEqual([]);
    await expect(readdir(managed.config.stagingRoot)).resolves.toEqual([]);
  });

  it("publishes concurrent duplicate names as independent opaque projects", async () => {
    const managed = await repository();
    const service = new ManagedProjectCreationService(managed, { storeSpecs: specs });

    const [first, second] = await Promise.all([
      service.create({ name: "Same name", platform: "apple", layoutMode: "isolated", templateId: null }),
      service.create({ name: "Same name", platform: "apple", layoutMode: "connected", templateId: null }),
    ]);

    expect(first.id).not.toBe(second.id);
    await expect(managed.list()).resolves.toHaveLength(2);
  });

  it("removes the restored stage when atomic catalog publication fails", async () => {
    const managed = await repository({
      catalog: {
        read: async () => ({ version: 2, generation: 0, entries: [], lifecycleCommits: [] }),
        get: async () => undefined,
        list: async () => [],
        listTrashed: async () => [],
        insert: async () => { throw new Error("injected catalog failure"); },
        removeActive: async () => undefined,
      },
    });
    const service = new ManagedProjectCreationService(managed, { storeSpecs: specs });

    await expect(service.create({
      name: "Rollback", platform: "apple", layoutMode: "isolated", templateId: null,
    })).rejects.toThrow("injected catalog failure");
    await expect(managed.list()).resolves.toEqual([]);
    await expect(readdir(managed.config.stagingRoot)).resolves.toEqual([]);
    await mkdir(managed.config.projectsRoot, { recursive: true });
    await expect(readdir(managed.config.projectsRoot)).resolves.toEqual([]);
  });

  it("preserves a stage claimed by ambiguous repository recovery", async () => {
    const identifier = "a".repeat(32);
    const managed = await repository({ randomId: () => identifier });
    const intentPath = join(managed.config.recoveryRoot, `project_${identifier}.json`);
    vi.spyOn(managed, "publishStage").mockImplementation(async ({ token, name }) => {
      await writeFile(intentPath, `${JSON.stringify({
        version: 1,
        operation: "publish",
        id: `project_${identifier}`,
        token,
        name,
        createdAt: "2026-07-19T00:00:00.000Z",
        phase: "prepared",
      })}\n`);
      throw new Error("injected ambiguous publication failure");
    });
    const service = new ManagedProjectCreationService(managed, { storeSpecs: specs });

    await expect(service.create({
      name: "Recovery owned", platform: "apple", layoutMode: "isolated", templateId: null,
    })).rejects.toThrow(/stage cleanup|recovery/i);

    await expect(lstat(join(managed.config.stagingRoot, `stage_${identifier}`))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(lstat(intentPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("cancels after staged revalidation and before managed publication", async () => {
    const managed = await repository();
    const controller = new AbortController();
    const publish = vi.spyOn(managed, "publishStage");
    const service = new ManagedProjectCreationService(managed, {
      storeSpecs: specs,
      async revalidateStage() {
        controller.abort();
      },
    });

    await expect(service.createFromValidatedScaffold(await service.buildScaffold({
      name: "Cancelled", platform: "apple", layoutMode: "isolated", templateId: null,
    }), { signal: controller.signal })).rejects.toThrow(/cancelled/i);

    expect(publish).not.toHaveBeenCalled();
    await expect(managed.list()).resolves.toEqual([]);
    await expect(readdir(managed.config.stagingRoot)).resolves.toEqual([]);
  });
});
