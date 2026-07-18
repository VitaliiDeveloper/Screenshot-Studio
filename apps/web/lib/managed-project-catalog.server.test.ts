// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  parseManagedProjectCatalog,
  serializeManagedProjectCatalog,
} from "./managed-project-catalog.server.js";

const PROJECT_ID = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function catalogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    directoryName: PROJECT_ID,
    name: "Alpha",
    lifecycle: "active",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveManagedProjectStorageConfig", () => {
  it("uses the invocation directory for the default managed data root", () => {
    const root = "/workspace/invocation";

    expect(resolveManagedProjectStorageConfig({ INIT_CWD: root })).toMatchObject({
      root: join(root, ".screenshot-studio"),
      projectsRoot: join(root, ".screenshot-studio", "projects"),
      stagingRoot: join(root, ".screenshot-studio", "staging"),
      recoveryRoot: join(root, ".screenshot-studio", "recovery"),
      catalogPath: join(root, ".screenshot-studio", "catalog.json"),
    });
  });

  it("resolves a relative data root from the invocation directory", () => {
    expect(resolveManagedProjectStorageConfig({
      INIT_CWD: "/workspace/invocation",
      SCREENSHOT_STUDIO_DATA_ROOT: "runtime-data",
    }).root).toBe("/workspace/invocation/runtime-data");
  });

  it("keeps an absolute data root absolute", () => {
    expect(resolveManagedProjectStorageConfig({
      INIT_CWD: "/workspace/invocation",
      SCREENSHOT_STUDIO_DATA_ROOT: "/var/lib/screenshot-studio",
    }).root).toBe("/var/lib/screenshot-studio");
  });

  it.each([
    ["SCREENSHOT_STUDIO_MAX_PROJECT_FILES", "0"],
    ["SCREENSHOT_STUDIO_MAX_PROJECT_BYTES", "-1"],
    ["SCREENSHOT_STUDIO_STAGING_TTL_MS", "1.5"],
  ])("rejects an invalid %s before filesystem access", (name, value) => {
    expect(() => resolveManagedProjectStorageConfig({ [name]: value })).toThrow(
      new RangeError(`${name} must be a positive integer`),
    );
  });
});

describe("parseManagedProjectCatalog", () => {
  it("accepts the version-one catalog contract and serializes entries deterministically", () => {
    const laterId = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const catalog = parseManagedProjectCatalog({
      version: 1,
      entries: [catalogEntry({ id: laterId, directoryName: laterId }), catalogEntry()],
    });

    expect(catalog.entries).toHaveLength(2);
    expect(serializeManagedProjectCatalog(catalog)).toBe(`${JSON.stringify({
      version: 1,
      entries: [catalogEntry(), catalogEntry({ id: laterId, directoryName: laterId })],
    }, null, 2)}\n`);
  });

  it.each([
    ["a version mismatch", { version: 2, entries: [] }],
    ["a malformed timestamp", { version: 1, entries: [catalogEntry({ createdAt: "tomorrow" })] }],
    ["duplicate ids", { version: 1, entries: [catalogEntry(), catalogEntry()] }],
    ["an invalid directory name", { version: 1, entries: [catalogEntry({ directoryName: "other" })] }],
    ["an unknown lifecycle", { version: 1, entries: [catalogEntry({ lifecycle: "trashed" })] }],
    ["unknown top-level properties", { version: 1, entries: [], future: true }],
    ["unknown entry properties", { version: 1, entries: [catalogEntry({ future: true })] }],
  ])("rejects %s", (_description, value) => {
    expect(() => parseManagedProjectCatalog(value)).toThrow();
  });
});
