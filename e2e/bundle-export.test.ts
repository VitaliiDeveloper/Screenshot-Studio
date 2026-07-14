// SPDX-License-Identifier: Apache-2.0
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  fitElementsToArtboard,
  parseProjectJson,
} from "../packages/core/src/model/index.js";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "../packages/core/src/export/index.js";
import { startWebServer } from "../packages/cli/src/server.js";
import { createRenderBrowserSession } from "../packages/cli/src/render-driver.js";
import { exportBundle } from "../packages/cli/src/export.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/multi-locale-export/app-store-screenshots.json");
const storeVariantFixturePath = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
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
    const server = await startWebServer(undefined, { storeSpecsPath });
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

  it("exports an explicit store-target variant at its own exact dimensions", async () => {
    const source = parseProjectJson(await readFile(storeVariantFixturePath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const target = specs.apple?.iphone?.find((candidate) => candidate.id === "6.5");
    expect(target).toBeDefined();

    const masterBefore = structuredClone(source.screens[0]!);
    const variantResult = ensureStoreTargetVariant(source, masterBefore.id, target!);
    const { project, variant } = variantResult;

    const directory = await mkdtemp(join(tmpdir(), "store-target-variant-export-"));
    const projectPath = join(directory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await writeFile(projectPath, JSON.stringify(project));
    await cp(resolve(repoRoot, "fixtures/sample/assets"), join(directory, "assets"), { recursive: true });

    const entry = buildBundleEntries(project, specs, {}).find((candidate) => candidate.screen.id === variant.id);
    expect(entry).toMatchObject({
      target: { id: "6.5", width: 1284, height: 2778 },
      relativePath: "apple/iphone/locale-en/01-hero-6.5.png",
    });

    const server = await startWebServer(undefined, { storeSpecsPath });
    const session = await createRenderBrowserSession();
    try {
      await exportBundle({
        baseUrl: server.url,
        projectPath,
        outDir,
        entries: [entry!],
        renderSession: session,
      });
      const info = inspectPng(await readFile(join(outDir, entry!.relativePath)));
      expect(info).toMatchObject({ width: 1284, height: 2778, hasAlpha: false });
      expect(project.screens.find((screen) => screen.id === masterBefore.id)).toEqual(masterBefore);
    } finally {
      await session.close();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it("exports a newly created watchOS output through the shared alpha-free path", async () => {
    const source = parseProjectJson(JSON.stringify({
      meta: { name: "watchOS export", schemaVersion: 1 },
      mode: "isolated",
      platforms: ["apple"],
      locales: ["en"],
      fonts: [],
      screens: [{
        id: "iphone-root",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#091226" },
        elements: [
          {
            id: "card", type: "shape", x: 70, y: 80, width: 282, height: 210,
            rotation: 0, opacity: 1, locked: false, visible: true,
            kind: "rect", fill: "#2563EB", radius: 28,
            stroke: { color: "#FFFFFF", width: 6 },
          },
          {
            id: "headline", type: "text", x: 76, y: 330, width: 270, height: 80,
            rotation: 0, opacity: 1, locked: false, visible: true,
            content: "Built for Watch", fontFamily: "Arial", size: 28, weight: 700,
            lineHeight: 1.2, letterSpacing: 1, align: "center", color: "#FFFFFF",
            shadow: { color: "#000000", blur: 12, offsetX: 3, offsetY: 6, opacity: 0.55 },
          },
        ],
      }],
    }));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const target = specs.apple?.watchos?.find((candidate) => candidate.id === "ultra-3");
    expect(target).toBeDefined();
    const result = ensureStoreOutputFamily(source, source.screens[0]!.id, "apple", "watchos", target!);
    expect(result.firstScreen).toMatchObject({
      platform: "apple",
      device: "watchos",
      variantOf: undefined,
      storeTargetId: undefined,
      artboard: { width: 1477, height: 1799 },
    });
    const exactReference = {
      ...structuredClone(source.screens[0]!),
      id: "watch-reference",
      name: "Reference",
      platform: "apple" as const,
      device: "watchos" as const,
      artboard: { width: target!.width, height: target!.height },
      elements: fitElementsToArtboard(
        source.screens[0]!.elements,
        source.screens[0]!.artboard,
        target!,
      ),
    };
    const project = parseProjectJson(JSON.stringify({
      ...result.project,
      screens: [...result.project.screens, exactReference],
    }));
    const entries = buildBundleEntries(project, specs, {});
    const entry = entries
      .find((candidate) => candidate.screen.id === result.firstScreen.id);
    const referenceEntry = entries
      .find((candidate) => candidate.screen.id === exactReference.id);
    expect(entry).toMatchObject({
      target: { id: "ultra-3", width: 422, height: 514 },
      relativePath: "apple/watchos/locale-en/01-hero-ultra-3.png",
    });
    expect(referenceEntry?.relativePath).toBe("apple/watchos/locale-en/02-reference-ultra-3.png");

    const directory = await mkdtemp(join(tmpdir(), "watchos-output-export-"));
    const projectPath = join(directory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await writeFile(projectPath, JSON.stringify(project));
    const server = await startWebServer(undefined, { storeSpecsPath });
    const session = await createRenderBrowserSession();
    try {
      await exportBundle({
        baseUrl: server.url,
        projectPath,
        outDir,
        entries: [entry!, referenceEntry!],
        renderSession: session,
      });
      const masterBytes = await readFile(join(outDir, entry!.relativePath));
      const referenceBytes = await readFile(join(outDir, referenceEntry!.relativePath));
      expect(inspectPng(masterBytes))
        .toMatchObject({ width: 422, height: 514, hasAlpha: false });

      const masterPng = PNG.sync.read(masterBytes);
      const referencePng = PNG.sync.read(referenceBytes);
      const diff = new PNG({ width: masterPng.width, height: masterPng.height });
      const mismatch = pixelmatch(
        masterPng.data,
        referencePng.data,
        diff.data,
        masterPng.width,
        masterPng.height,
        { threshold: 0.1 },
      );
      expect(mismatch).toBe(0);
    } finally {
      await session.close();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
