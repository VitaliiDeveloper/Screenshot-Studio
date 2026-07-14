// SPDX-License-Identifier: Apache-2.0
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { parseProjectJson } from "../packages/core/src/model/index.js";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "../packages/core/src/export/index.js";
import { startWebServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/regressions/multi-locale-export");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const expectedPaths = [
  "apple/iphone/locale-en/01-english-one-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/01-arabic-one-6.9.png",
  "apple/iphone/locale-en/02-english-two-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/02-arabic-two-6.9.png",
  "apple/ipad/locale-en/01-english-ipad-13.png",
  "android/phone/locale-en_~0055~0053/01-underscore-android-phone-portrait.png",
];

afterEach(() => {
  delete process.env.PROJECT_PATH;
  delete process.env.STORE_SPECS_PATH;
});

describe("Phase 4 multi-locale UI export", () => {
  it("exports safe per-group-numbered paths with exact dims and no alpha", async () => {
    // Copy the whole fixture (assets resolve relative to the project dir) into a temp workspace,
    // and point the server's resolveProjectPath at it, so export writes to <temp>/export.
    const workspace = await mkdtemp(join(tmpdir(), "ui-export-"));
    await cp(fixtureDir, workspace, { recursive: true });
    const projectPath = join(workspace, "app-store-screenshots.json");
    process.env.PROJECT_PATH = projectPath;
    process.env.STORE_SPECS_PATH = storeSpecsPath;

    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const expected = buildBundleEntries(project, specs, {});
    expect(expected.map((entry) => entry.relativePath)).toEqual(expectedPaths);

    const server = await startWebServer();
    try {
      const res = await fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status !== 200) throw new Error(`UI export failed (${res.status}): ${await res.text()}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");

      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
      expect(names).toEqual([...expectedPaths].sort());

      for (const entry of expected) {
        const png = await zip.file(entry.relativePath)!.async("nodebuffer");
        const info = inspectPng(png);
        expect(info.width).toBe(entry.target.width);
        expect(info.height).toBe(entry.target.height);
        expect(info.hasAlpha).toBe(false);
      }
    } finally {
      await server.stop();
    }
  }, 180_000);
});
