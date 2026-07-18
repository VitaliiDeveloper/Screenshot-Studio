// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  ManagedProjectImportError,
  ManagedProjectImportService,
  type ProjectImportFile,
} from "./managed-project-import.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";

const temporaryRoots: string[] = [];

function projectJson(input: { name?: string; assetUrl?: string; fontPath?: string } = {}): string {
  return JSON.stringify({
    meta: { name: input.name ?? "Imported", schemaVersion: 1 },
    fonts: input.fontPath
      ? [{ family: "Inter", source: "uploaded", path: input.fontPath, weight: 400 }]
      : [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: input.assetUrl ? [{
          id: "shot",
          type: "screenshot",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          assetUrl: input.assetUrl,
          fit: "cover",
          cornerRadius: 0,
        }] : [],
      }],
    }],
  });
}

function importFile(relativePath: string, value: string | Uint8Array, declaredSize?: number): ProjectImportFile {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return {
    relativePath,
    declaredSize: declaredSize ?? bytes.byteLength,
    async *open() { yield bytes; },
  };
}

async function createService(environment: Readonly<Record<string, string | undefined>> = {}) {
  const root = await mkdtemp(join(tmpdir(), "managed-project-import-"));
  temporaryRoots.push(root);
  const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100000",
    ...environment,
  }));
  return { root, repository, service: new ManagedProjectImportService(repository) };
}

async function stageEntries(repository: ManagedProjectRepository): Promise<string[]> {
  try {
    return await readdir(repository.config.stagingRoot);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ManagedProjectImportService", () => {
  it("normalizes a selected folder root and publishes its complete managed copy", async () => {
    const { repository, service } = await createService();
    const image = new Uint8Array([1, 2, 3, 4]);

    const record = await service.import({
      kind: "folder",
      files: [
        importFile("My Project/app-store-screenshots.json", projectJson({
          name: "Folder project",
          assetUrl: "screenshots/hero.png",
          fontPath: "assets/fonts/inter.woff2",
        })),
        importFile("My Project/screenshots/hero.png", image),
        importFile("My Project/assets/fonts/inter.woff2", new Uint8Array([5, 6, 7])),
        importFile("My Project/AGENTS.md", "# Project guidance\n"),
      ],
    });

    expect(record.name).toBe("Folder project");
    await expect(repository.list()).resolves.toMatchObject([{ id: record.id, name: "Folder project" }]);
    await expect(readFile(join(record.projectDirectory, "screenshots/hero.png")))
      .resolves.toEqual(Buffer.from(image));
    await expect(readFile(join(record.projectDirectory, "AGENTS.md"), "utf8"))
      .resolves.toBe("# Project guidance\n");
  });

  it("requires exactly one root manifest and rejects portable-path collisions", async () => {
    const { repository, service } = await createService();

    await expect(service.import({
      kind: "archive",
      files: [
        importFile("app-store-screenshots.json", projectJson()),
        importFile("nested/app-store-screenshots.json", projectJson()),
      ],
    })).rejects.toMatchObject({ code: "duplicate" });
    await expect(service.import({
      kind: "archive",
      files: [importFile("nested/app-store-screenshots.json", projectJson())],
    })).rejects.toMatchObject({ code: "invalid-project" });
    await expect(service.import({
      kind: "archive",
      files: [
        importFile("app-store-screenshots.json", projectJson()),
        importFile("assets/Hero.png", "one"),
        importFile("assets/hero.png", "two"),
      ],
    })).rejects.toMatchObject({ code: "duplicate" });
    await expect(repository.list()).resolves.toEqual([]);
  });

  it.each(["../escape.png", "/absolute.png", "assets\\escape.png"])(
    "rejects unsafe input path %s before staging",
    async (relativePath) => {
      const { repository, service } = await createService();
      await expect(service.import({
        kind: "archive",
        files: [
          importFile("app-store-screenshots.json", projectJson()),
          importFile(relativePath, "unsafe"),
        ],
      })).rejects.toMatchObject({ code: "invalid-path" });
      await expect(repository.list()).resolves.toEqual([]);
    },
  );

  it("rejects paths whose encoded length exceeds the bounded staging contract", async () => {
    const { service } = await createService();
    await expect(service.import({
      kind: "archive",
      files: [
        importFile("app-store-screenshots.json", projectJson()),
        importFile(`assets/${"a".repeat(1_100)}.png`, "oversized path"),
      ],
    })).rejects.toMatchObject({ code: "invalid-path" });
  });

  it("rejects unsupported and credential-bearing inputs instead of silently copying them", async () => {
    const { service } = await createService();
    await expect(service.import({
      kind: "archive",
      files: [
        importFile("app-store-screenshots.json", projectJson()),
        importFile("assets/signing.pem", "private"),
      ],
    })).rejects.toMatchObject({ code: "invalid-path" });
  });

  it("strictly validates the project and lists absent project-relative resources", async () => {
    const { service } = await createService();
    await expect(service.import({
      kind: "json",
      files: [importFile("selected.json", projectJson({
        assetUrl: "screenshots/missing.png",
        fontPath: "assets/fonts/missing.woff2",
      }))],
    })).rejects.toMatchObject({
      code: "missing-resources",
      missingResources: ["assets/fonts/missing.woff2", "screenshots/missing.png"],
    });
    await expect(service.import({
      kind: "json",
      files: [importFile("selected.json", JSON.stringify({ unknown: true }))],
    })).rejects.toMatchObject({ code: "invalid-project" });
  });

  it("imports eligible standalone JSON as the root project document", async () => {
    const { service } = await createService();
    const record = await service.import({
      kind: "json",
      files: [importFile("portable.json", projectJson({ name: "JSON only" }))],
    });

    await expect(readFile(record.projectPath, "utf8")).resolves.toContain('"JSON only"');
  });

  it("enforces declared and actual file limits before catalog publication", async () => {
    const declared = await createService({ SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "500" });
    await expect(declared.service.import({
      kind: "archive",
      files: [importFile("app-store-screenshots.json", projectJson(), 501)],
    })).rejects.toMatchObject({ code: "limit" });

    const actual = await createService({ SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100" });
    await expect(actual.service.import({
      kind: "archive",
      files: [importFile("app-store-screenshots.json", projectJson())],
    })).rejects.toMatchObject({ code: "limit" });

    const count = await createService({ SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "1" });
    await expect(count.service.import({
      kind: "archive",
      files: [
        importFile("app-store-screenshots.json", projectJson()),
        importFile("assets/extra.png", "extra"),
      ],
    })).rejects.toMatchObject({ code: "limit" });
    await expect(count.repository.list()).resolves.toEqual([]);
  });

  it("removes its exact stage on cancellation and streaming failure", async () => {
    const cancelled = await createService();
    const controller = new AbortController();
    controller.abort();
    await expect(cancelled.service.import({
      kind: "json",
      files: [importFile("project.json", projectJson())],
      signal: controller.signal,
    })).rejects.toBeInstanceOf(ManagedProjectImportError);
    await expect(stageEntries(cancelled.repository)).resolves.toEqual([]);

    const failed = await createService();
    const broken: ProjectImportFile = {
      relativePath: "assets/broken.png",
      declaredSize: 1,
      async *open() {
        yield new Uint8Array([0]);
        throw new Error("injected stream failure");
      },
    };
    await expect(failed.service.import({
      kind: "archive",
      files: [importFile("app-store-screenshots.json", projectJson()), broken],
    })).rejects.toThrow("injected stream failure");
    await expect(stageEntries(failed.repository)).resolves.toEqual([]);
    await expect(failed.repository.list()).resolves.toEqual([]);
  });
});
