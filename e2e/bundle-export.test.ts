// SPDX-License-Identifier: Apache-2.0
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import {
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  parseProjectJson,
} from "@screenshot-studio/core/model";
import { buildBundleEntries, findStoreTarget, inspectPng, parseStoreSpecs } from "@screenshot-studio/core/export";
import { projectMutationLockPath } from "@screenshot-studio/core/storage";
import { startWebServer } from "@screenshot-studio/cli/server";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { exportBundle, withStableProjectExport } from "@screenshot-studio/cli/export";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDirectory = resolve(repoRoot, "fixtures/regressions/multi-locale-export");
const fixturePath = resolve(fixtureDirectory, "app-store-screenshots.json");
const storeVariantFixturePath = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const RGBA_CHANNEL_COUNT = 4;

const expectedPaths = [
  "apple/iphone/locale-en/01-english-one-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/01-arabic-one-6.9.png",
  "apple/iphone/locale-en/02-english-two-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/02-arabic-two-6.9.png",
  "apple/ipad/locale-en/01-english-ipad-13.png",
  "android/phone/locale-en_~0055~0053/01-underscore-android-phone-portrait.png",
];

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (y * png.width + x) * RGBA_CHANNEL_COUNT;
  const [red, green, blue] = png.data.subarray(offset, offset + RGBA_CHANNEL_COUNT);
  return [red!, green!, blue!];
}

afterAll(async () => {
  await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  await expect(stat(projectMutationLockPath(fixturePath))).rejects.toMatchObject({ code: "ENOENT" });
});

describe("multi-locale bundle export", () => {
  it("exports safe per-group-numbered PNGs and a zip using one server/browser session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase-4-bundle-"));
    const projectDirectory = join(directory, "project");
    const projectPath = join(projectDirectory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await cp(fixtureDirectory, projectDirectory, { recursive: true });
    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const entries = buildBundleEntries(project, project.preferredExportLayoutId, specs, {});
    expect(entries.map((entry) => entry.relativePath)).toEqual(expectedPaths);
    const server = await startWebServer(undefined, { storeSpecsPath });
    const session = await createRenderBrowserSession();
    try {
      const zipPath = await withStableProjectExport(projectPath, (context) => exportBundle({
        baseUrl: server.url,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId: project.preferredExportLayoutId,
        outDir,
        entries,
        renderSession: session,
        publicationGuard: context.publish,
      }));

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
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it("exports an explicit store-target variant at its own exact dimensions", async () => {
    const source = parseProjectJson(await readFile(storeVariantFixturePath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const target = findStoreTarget(specs, "apple", "iphone", "6.5");
    expect(target).toBeDefined();

    const masterBefore = structuredClone(source.layouts[0].screens[0]!);
    const variantResult = ensureStoreTargetVariant(
      source,
      source.preferredExportLayoutId,
      masterBefore.id,
      target!,
    );
    const { project, variant } = variantResult;

    const directory = await mkdtemp(join(tmpdir(), "store-target-variant-export-"));
    const projectPath = join(directory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await writeFile(projectPath, JSON.stringify(project));
    await cp(resolve(repoRoot, "fixtures/sample/assets"), join(directory, "assets"), { recursive: true });

    const entry = buildBundleEntries(project, project.preferredExportLayoutId, specs, {}).find((candidate) => candidate.screen.id === variant.id);
    expect(entry).toMatchObject({
      target: { id: "6.5", width: 1284, height: 2778 },
      relativePath: "apple/iphone/locale-en/01-hero-6.5.png",
    });

    const server = await startWebServer(undefined, { storeSpecsPath });
    const session = await createRenderBrowserSession();
    try {
      await withStableProjectExport(projectPath, (context) => exportBundle({
        baseUrl: server.url,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId: project.preferredExportLayoutId,
        outDir,
        entries: [entry!],
        renderSession: session,
        publicationGuard: context.publish,
      }));
      const info = inspectPng(await readFile(join(outDir, entry!.relativePath)));
      expect(info).toMatchObject({ width: 1284, height: 2778, hasAlpha: false });
      expect(project.layouts[0].screens.find((screen) => screen.id === masterBefore.id)).toEqual(masterBefore);
    } finally {
      await session.close();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);

  it("exports a newly created watchOS output through the shared alpha-free path", async () => {
    const watchCardFill = "#2563EB";
    const watchCardRgb = Array.from(Buffer.from(watchCardFill.slice(1), "hex"));
    const source = parseProjectJson(JSON.stringify({
      meta: { name: "watchOS export", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "default",
      layouts: [{
        id: "default",
        name: "Default",
        mode: "isolated",
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
              kind: "rect", fill: watchCardFill, radius: 28,
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
      }],
    }));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const target = findStoreTarget(specs, "apple", "watchos", "ultra-3");
    const series11Target = findStoreTarget(specs, "apple", "watchos", "series-11");
    expect(target).toBeDefined();
    expect(series11Target).toBeDefined();
    const result = ensureStoreOutputFamily(
      source,
      source.preferredExportLayoutId,
      source.layouts[0]!.screens[0]!.id,
      "apple",
      "watchos",
      target!,
    );
    expect(result.firstScreen).toMatchObject({
      platform: "apple",
      device: "watchos",
      variantOf: undefined,
      storeTargetId: undefined,
      artboard: { width: 1477, height: 1799 },
    });
    const variantResult = ensureStoreTargetVariant(
      result.project,
      result.project.preferredExportLayoutId,
      result.firstScreen.id,
      series11Target!,
    );
    expect(variantResult.variant).toMatchObject({
      variantOf: result.firstScreen.id,
      storeTargetId: "series-11",
      artboard: { width: 1456, height: 1736 },
    });
    const project = variantResult.project;
    const entries = buildBundleEntries(project, project.preferredExportLayoutId, specs, {});
    const entry = entries
      .find((candidate) => candidate.screen.id === result.firstScreen.id);
    const variantEntry = entries
      .find((candidate) => candidate.screen.id === variantResult.variant.id);
    expect(entry).toMatchObject({
      target: { id: "ultra-3", width: 422, height: 514 },
      relativePath: "apple/watchos/locale-en/01-hero-ultra-3.png",
    });
    expect(variantEntry).toMatchObject({
      target: { id: "series-11", width: 416, height: 496 },
      relativePath: "apple/watchos/locale-en/01-hero-series-11.png",
    });

    const directory = await mkdtemp(join(tmpdir(), "watchos-output-export-"));
    const projectPath = join(directory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await writeFile(projectPath, JSON.stringify(project));
    const server = await startWebServer(undefined, { storeSpecsPath });
    const session = await createRenderBrowserSession();
    try {
      await withStableProjectExport(projectPath, (context) => exportBundle({
        baseUrl: server.url,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId: project.preferredExportLayoutId,
        outDir,
        entries: [entry!, variantEntry!],
        renderSession: session,
        publicationGuard: context.publish,
      }));
      const masterBytes = await readFile(join(outDir, entry!.relativePath));
      expect(inspectPng(masterBytes))
        .toMatchObject({ width: 422, height: 514, hasAlpha: false });
      const variantBytes = await readFile(join(outDir, variantEntry!.relativePath));
      expect(inspectPng(variantBytes))
        .toMatchObject({ width: 416, height: 496, hasAlpha: false });

      for (const [bytes, bundleEntry] of [[masterBytes, entry!], [variantBytes, variantEntry!]] as const) {
        const card = bundleEntry.screen.elements.find((element) => element.type === "shape");
        if (!card) throw new Error("Expected the watchOS fixture to contain its blue card");
        const x = Math.floor(
          (card.x + card.width / 2) * bundleEntry.target.width / bundleEntry.screen.artboard.width,
        );
        const y = Math.floor(
          (card.y + card.height / 2) * bundleEntry.target.height / bundleEntry.screen.artboard.height,
        );
        expect(pixel(PNG.sync.read(bytes), x, y)).toEqual(watchCardRgb);
      }
    } finally {
      await session.close();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
