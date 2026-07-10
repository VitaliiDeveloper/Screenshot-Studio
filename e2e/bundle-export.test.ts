import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseProjectJson } from "../packages/core/src/model/index.js";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "../packages/core/src/export/index.js";
import { startWebServer } from "../packages/cli/src/server.js";
import { createRenderBrowserSession } from "../packages/cli/src/render-driver.js";
import { exportBundle } from "../packages/cli/src/export.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-4-multi-locale/app-store-screenshots.json");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");

const expectedPaths = [
  "apple/iphone/locale-en/01-english-one-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/01-arabic-one-6.9.png",
  "apple/iphone/locale-en/02-english-two-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/02-arabic-two-6.9.png",
  "apple/ipad/locale-en/01-english-ipad-13.png",
  "android/phone/locale-en_~0055~0053/01-underscore-android-phone-portrait.png",
];

describe("Phase 4 multi-locale bundle export", () => {
  it("exports safe per-group-numbered PNGs and a zip using one server/browser session", async () => {
    const project = parseProjectJson(await readFile(fixturePath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const entries = buildBundleEntries(project, specs, {});
    expect(entries.map((entry) => entry.relativePath)).toEqual(expectedPaths);
    const outDir = await mkdtemp(join(tmpdir(), "phase-4-bundle-"));
    const server = await startWebServer();
    const session = await createRenderBrowserSession();
    try {
      const zipPath = await exportBundle({
        baseUrl: server.url,
        projectPath: fixturePath,
        outDir,
        entries,
        renderSession: session,
      });

      for (const entry of entries) {
        const png = await readFile(join(outDir, entry.relativePath));
        const info = inspectPng(png);
        expect(info.width).toBe(entry.target.width);
        expect(info.height).toBe(entry.target.height);
        expect(info.hasAlpha).toBe(false);
      }

      await expect(stat(zipPath)).resolves.toBeTruthy();
      const zip = await JSZip.loadAsync(await readFile(zipPath));
      expect(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.name).sort()).toEqual(
        [...expectedPaths].sort(),
      );
    } finally {
      await session.close();
      await server.stop();
    }
  }, 180_000);
});
