// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCaptureImport } from "@screenshot-studio/core/capture-import";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectCreationService } from "./managed-project-creation.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import {
  createManagedProjectFromCaptureImport,
  previewManagedProjectCaptureImport,
} from "./managed-capture-import.server.js";

const roots: string[] = [];
const specs = parseStoreSpecs({
  apple: { iphone: [{ id: "6.9", label: "Apple lead", width: 1320, height: 2868, orientation: "portrait" }] },
  android: { phone: [{ id: "phone-portrait", label: "Android lead", width: 1080, height: 1920, orientation: "portrait" }] },
  windows: { desktop: [{ id: "4k", label: "Windows lead", width: 1920, height: 1080, orientation: "landscape" }] },
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "managed-capture-import-"));
  roots.push(root);
  const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "10000000",
  }));
  const service = new ManagedProjectCreationService(repository, { storeSpecs: specs });
  return { repository, service };
}

describe("createManagedProjectFromCaptureImport", () => {
  it("previews without staging or catalog writes and requires that exact confirmation on apply", async () => {
    const { repository, service } = await setup();
    const png = new Uint8Array(await readFile(new URL(
      "../../../fixtures/regressions/screenshot-parity/assets/shot.png",
      import.meta.url,
    )));
    const discovery = discoverCaptureImport({
      files: [{ relativePath: "apple/iphone/en/01.png", bytes: png }],
    });
    const scaffoldInput = {
      name: "Preview only", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
    } as const;
    const createStage = vi.spyOn(repository, "createStage");

    const preview = await previewManagedProjectCaptureImport({
      scaffoldInput, discovery, creationService: service,
    });

    expect(preview.receiving).toMatchObject({
      kind: "new-project", projectName: "Preview only", layoutId: "default",
    });
    expect(createStage).not.toHaveBeenCalled();
    await expect(repository.list()).resolves.toEqual([]);

    await expect(createManagedProjectFromCaptureImport({
      scaffoldInput,
      discovery,
      confirmationFingerprint: "0".repeat(64),
      creationService: service,
    })).rejects.toThrow(/preview changed/i);
    expect(createStage).not.toHaveBeenCalled();
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("replaces only starter screens and publishes once through the creation seam", async () => {
    const { repository, service } = await setup();
    const png = new Uint8Array(await readFile(new URL(
      "../../../fixtures/regressions/screenshot-parity/assets/shot.png",
      import.meta.url,
    )));
    const discovery = discoverCaptureImport({
      files: [
        { relativePath: "apple/iphone/en/01.png", bytes: png },
        { relativePath: "assets/icons/product.png", bytes: new Uint8Array([1, 2, 3]) },
      ],
    });
    const publish = vi.spyOn(service, "createFromValidatedScaffold");

    const record = await createManagedProjectFromCaptureImport({
      scaffoldInput: {
        name: "Captured", platform: "apple", device: "iphone", layoutMode: "connected", templateId: null,
      },
      discovery,
      creationService: service,
    });

    expect(publish).toHaveBeenCalledOnce();
    const project = JSON.parse(await readFile(record.projectPath, "utf8")) as {
      meta: { name: string };
      layouts: Array<{ id: string; mode: string; screens: Array<{ id: string }> }>;
    };
    expect(project.meta.name).toBe("Captured");
    expect(project.layouts[0]).toMatchObject({
      id: "default",
      mode: "connected",
      screens: [{ id: "apple-iphone-en-01" }],
    });
    expect(project.layouts[0]!.screens.map(({ id }) => id)).not.toContain("hero");
    expect([...await readFile(join(record.projectPath, "..", "assets", "icons", "product.png"))])
      .toEqual([1, 2, 3]);
    await expect(repository.list()).resolves.toMatchObject([{
      id: record.id,
      name: "Captured",
      lifecycle: "active",
    }]);
  });

  it("does not allocate or publish when preview is invalid or cancelled", async () => {
    const { repository, service } = await setup();
    const createStage = vi.spyOn(repository, "createStage");
    const invalid = discoverCaptureImport({
      files: [{ relativePath: "apple/iphone/en/01.png", bytes: new Uint8Array([1, 2, 3]) }],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(createManagedProjectFromCaptureImport({
      scaffoldInput: {
        name: "Invalid", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
      },
      discovery: invalid,
      creationService: service,
    })).rejects.toThrow(/invalid/i);
    await expect(createManagedProjectFromCaptureImport({
      scaffoldInput: {
        name: "Cancelled", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
      },
      discovery: invalid,
      creationService: service,
      signal: controller.signal,
    })).rejects.toThrow(/cancelled/i);
    expect(createStage).not.toHaveBeenCalled();
  });
});
