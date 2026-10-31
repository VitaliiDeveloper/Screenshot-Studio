// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createRenderBrowserSession, type RenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";
import { createProjectTemplatePackScreens, exportLayoutPack } from "@screenshot-studio/cli/template-service";
import { parseStoreSpecs, stripAlpha } from "@screenshot-studio/core/export";
import { DEFAULT_TEXT_FONT, parseProject } from "@screenshot-studio/core/model";

/**
 * A layout exported with `template export-pack`, copied into another project's `packs/`, and added
 * there with `template add --pack` must render its first screen pixel-identical to the source,
 * with every pack asset served from the receiving project's own assets folder.
 */

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const specsPath = resolve(repoRoot, "store-specs.json");
const storeSpecs = parseStoreSpecs(JSON.parse(readFileSync(specsPath, "utf8")));
const shot = resolve(repoRoot, "fixtures/regressions/screenshot-parity/assets/shot.png");
const artboard = { width: 1206, height: 2622 };
const leaf = { rotation: 0, opacity: 1, locked: false, visible: true };

let server: RunningServer;
let session: RenderBrowserSession;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(resolve(tmpdir(), "project-pack-round-trip-"));
  server = await startWebServer(undefined, { storeSpecsPath: specsPath });
  session = await createRenderBrowserSession();
}, 180_000);

afterAll(async () => {
  await session?.close();
  await server?.stop();
  rmSync(root, { recursive: true, force: true });
});

function writeProject(name: string, screens: unknown[]): string {
  const dir = resolve(root, name);
  mkdirSync(resolve(dir, "assets"), { recursive: true });
  const path = resolve(dir, "app-store-screenshots.json");
  writeFileSync(path, JSON.stringify(parseProject({
    meta: { name, schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Launch", mode: "isolated", screens }],
  })));
  return path;
}

async function render(projectPath: string, screenId: string): Promise<PNG> {
  return PNG.sync.read(stripAlpha(await session.renderScreenToPng({
    baseUrl: server.url, projectPath, layoutId: "default", screenId, pixelRatio: 1, timeoutMs: 60_000,
  })));
}

describe("project pack round trip", () => {
  it("renders the applied pack's first screen identical to the exported layout", async () => {
    const source = writeProject("source", [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard,
      background: { type: "image", assetUrl: "assets/backdrop.png", fit: "cover" },
      elements: [
        { id: "card", type: "shape", role: "surface", x: 80, y: 140, width: 1046, height: 520, ...leaf, kind: "rect", fill: "#0F172A", radius: 48 },
        { id: "title", type: "text", role: "heading", x: 120, y: 200, width: 966, height: 360, ...leaf, content: "Ship the house style", fontFamily: DEFAULT_TEXT_FONT.family, size: 120, weight: DEFAULT_TEXT_FONT.weight, lineHeight: 1.1, letterSpacing: 0, align: "left", color: "#F8FAFC" },
        { id: "logo", type: "image", x: 403, y: 1100, width: 400, height: 400, ...leaf, assetUrl: "assets/decor/logo.png", fit: "contain" },
      ],
    }]);
    const sourceDir = resolve(source, "..");
    copyFileSync(shot, join(sourceDir, "assets/backdrop.png"));
    mkdirSync(join(sourceDir, "assets/decor"));
    copyFileSync(shot, join(sourceDir, "assets/decor/logo.png"));

    const exported = await exportLayoutPack(source, join(sourceDir, "packs/house"), { layout: "default" });
    expect(exported.assets).toEqual(["assets/backdrop.png", "assets/decor/logo.png"]);

    const target = writeProject("target", [{
      id: "seed", name: "Seed", platform: "apple", device: "iphone", locale: "en", artboard,
      background: { type: "solid", color: "#000000" }, elements: [],
    }]);
    cpSync(join(sourceDir, "packs"), join(resolve(target, ".."), "packs"), { recursive: true });
    const { screens } = await createProjectTemplatePackScreens(target, "house", "en", storeSpecs);
    const applied = screens[0]!;
    expect(applied.background).toMatchObject({ type: "image", assetUrl: expect.stringMatching(/^assets\/packs\/house\/[0-9a-f]{12}-backdrop\.png$/) });

    // The render host skips an image it cannot load, so prove every applied asset is served first.
    const urls = [applied.background, ...applied.elements].flatMap((item) => "assetUrl" in item && item.assetUrl ? [item.assetUrl] : []);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const response = await fetch(`${server.url}/api/asset?${new URLSearchParams({ project: target, path: url })}`);
      expect(response.status, url).toBe(200);
    }

    const expected = await render(source, "hero");
    const actual = await render(target, applied.id);
    expect([actual.width, actual.height]).toEqual([artboard.width, artboard.height]);
    expect(pixelmatch(expected.data, actual.data, undefined, artboard.width, artboard.height, { threshold: 0 })).toBe(0);
  });
});
