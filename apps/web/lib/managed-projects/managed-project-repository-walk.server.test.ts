// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectImportService } from "./managed-project-import.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";

const vanishing = vi.hoisted(() => ({ name: "" }));

// Removes the named entry just before its first inspection, as a lock holder releasing between the
// directory listing and the lstat of a concurrent validation.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (vanishing.name && String(args[0]).endsWith(vanishing.name)) {
        await actual.rm(args[0], { recursive: true, force: true });
      }
      return actual.lstat(...args);
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  vanishing.name = "";
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("validates a published project while a lock entry disappears mid-walk", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-project-walk-"));
  roots.push(root);
  const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
  }));
  const project = JSON.stringify({
    meta: { name: "Walk", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" }, elements: [],
      }],
    }],
  });
  const bytes = new TextEncoder().encode(project);
  const imported = await new ManagedProjectImportService(repository).import({
    kind: "archive",
    files: [{ relativePath: "app-store-screenshots.json", declaredSize: bytes.byteLength, async *open() { yield bytes; } }],
  });
  await mkdir(join(imported.projectDirectory, ".app-store-screenshots.json.screenshot-studio.lock"));
  vanishing.name = ".screenshot-studio.lock";

  await expect(repository.open(imported.id)).resolves.toMatchObject({ id: imported.id });
});
