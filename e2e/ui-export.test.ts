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
const fixtureDir = resolve(repoRoot, "fixtures/phase-2-bundle");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");

afterEach(() => {
  delete process.env.PROJECT_PATH;
});

describe("Phase 2 Slice 3 UI export", () => {
  it("exports the bundle zip through POST /api/export with exact dims and no alpha", async () => {
    // Copy the whole fixture (assets resolve relative to the project dir) into a temp workspace,
    // and point the server's resolveProjectPath at it, so export writes to <temp>/export.
    const workspace = await mkdtemp(join(tmpdir(), "ui-export-"));
    await cp(fixtureDir, workspace, { recursive: true });
    const projectPath = join(workspace, "app-store-screenshots.json");
    process.env.PROJECT_PATH = projectPath;

    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const expected = buildBundleEntries(project, specs, {});

    const server = await startWebServer();
    try {
      const res = await fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");

      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
      expect(names).toEqual(expected.map((e) => e.relativePath).sort());

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
