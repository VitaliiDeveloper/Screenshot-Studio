// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer } from "@screenshot-studio/cli/server";
import { inspectPng, parseStoreSpecs, stripAlpha } from "@screenshot-studio/core/export";
import { mapElementLeaves, parseProject, type Project, type TextElement } from "@screenshot-studio/core/model";
import { createScreensFromTemplatePack, listBuiltInTemplatePacks } from "@screenshot-studio/core/templates";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

/**
 * Every styled screen pack, materialized through the same core path the editor and CLI use, must
 * render alike headed and headless at the exact store size, keep 1.5× longer copy inside its text
 * boxes, and hold Arabic RTL copy in a registered project font.
 * TEMPLATE_PREVIEWS_OUT=1 also rewrites the picker previews from the same renderer.
 */

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const specsPath = resolve(repoRoot, "store-specs.json");
const storeSpecs = parseStoreSpecs(JSON.parse(readFileSync(specsPath, "utf8")));
const arabicFont = resolve(repoRoot, "fixtures/regressions/rtl-parity/assets/fonts/noto-sans-arabic-700.ttf");
const previewRoot = resolve(repoRoot, "apps/web/public/template-previews");
const PREVIEW_WIDTH = 300;
const MAX_MISMATCH_FRACTION = 0.001;
const packs = listBuiltInTemplatePacks(storeSpecs).filter((pack) => pack.id !== "neutral-iphone-basics");

const ARABIC: Record<NonNullable<TextElement["role"]>, string> = {
  heading: "كل ما تحتاجه في مكان واحد",
  body: "قل ما يفعله تطبيقك في سطر واحد قصير وواضح.",
  accent: "تطبيقك",
  surface: "حمّل الآن",
};

let harness: ParityRenderHarness;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(resolve(tmpdir(), "template-pack-parity-"));
  harness = await startParityRenderHarness(() => startWebServer(undefined, { storeSpecsPath: specsPath }), () => chromium.launch());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
  rmSync(root, { recursive: true, force: true });
});

function writeProject(name: string, locale: string, direction: "ltr" | "rtl", text?: (leaf: TextElement) => Partial<TextElement>): string {
  let project: Project = {
    meta: { name, schemaVersion: 1 },
    fonts: [{ family: "Noto Sans Arabic", source: "google", path: "assets/fonts/noto-sans-arabic-700.ttf", weight: 700 }],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "isolated",
      screens: [{ id: "seed", name: "Seed", platform: "apple", device: "iphone", locale, direction, artboard: { width: 1206, height: 2622 }, background: { type: "solid", color: "#000000" }, elements: [] }],
    }],
  };
  for (const pack of packs) project = createScreensFromTemplatePack(project, "default", pack, locale, storeSpecs).project;
  const layout = project.layouts[0]!;
  layout.screens = layout.screens.filter((screen) => screen.id !== "seed").map((screen) => ({
    ...screen,
    elements: screen.elements.map((element) => mapElementLeaves(element, (leaf) => (
      leaf.type === "text" && text ? { ...leaf, ...text(leaf) } : leaf
    ))),
  }));
  expect(layout.screens.map((screen) => screen.id)).toEqual(packs.flatMap((pack) => pack.screens.map((screen) => screen.id)));
  expect(layout.screens.every((screen) => screen.direction === direction)).toBe(true);
  const dir = resolve(root, name);
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  copyFileSync(arabicFont, resolve(dir, "assets/fonts/noto-sans-arabic-700.ttf"));
  const path = resolve(dir, "app-store-screenshots.json");
  writeFileSync(path, JSON.stringify(parseProject(project)));
  return path;
}

function render(renderer: ParityRenderHarness["headless"], projectPath: string, screenId: string, pixelRatio = 1): Promise<Buffer> {
  return renderer.renderScreenToPng({
    baseUrl: harness.server.url, projectPath, layoutId: "default", screenId, pixelRatio, timeoutMs: 60_000,
  }).then(stripAlpha);
}

function mismatchFraction(a: Buffer, b: Buffer): number {
  const first = PNG.sync.read(a);
  const second = PNG.sync.read(b);
  expect([first.width, first.height]).toEqual([second.width, second.height]);
  const mismatch = pixelmatch(first.data, second.data, undefined, first.width, first.height, { threshold: 0.1 });
  return mismatch / (first.width * first.height);
}

/** Measures the stage's own Konva.Text nodes the same way the editor's text-overflow issue does. */
async function overflowingText(projectPath: string, screenId: string): Promise<string[]> {
  const page = await harness.interactive!.newPage();
  try {
    const query = new URLSearchParams({ project: projectPath, layout: "default", screen: screenId });
    await page.goto(`${harness.server.url}/render?${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__stageReady === true || window.__renderError);
    expect(await page.evaluate(() => window.__renderError ?? null)).toBeNull();
    return await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Konva = (window as any).Konva;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Konva.stages.flatMap((stage: any) => stage.find("Text")).filter((node: any) => {
        const unbounded = new Konva.Text({ ...node.attrs, height: undefined });
        return unbounded.textArr.length > node.textArr.length || node.lineHeight() * node.fontSize() > node.height();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).map((node: any) => node.text());
    });
  } finally {
    await page.close();
  }
}

describe("styled template pack rendering", () => {
  it("renders every screen alike headed and headless at its exact store size", async () => {
    const projectPath = writeProject("en", "en", "ltr");
    for (const pack of packs) {
      for (const screen of pack.screens) {
        const headed = await render(harness.headed, projectPath, screen.id);
        const headless = await render(harness.headless, projectPath, screen.id);
        for (const png of [headed, headless]) {
          expect(inspectPng(png), screen.id).toMatchObject({ ...screen.artboard, hasAlpha: false });
        }
        expect(mismatchFraction(headed, headless), screen.id).toBeLessThan(MAX_MISMATCH_FRACTION);

        if (process.env.TEMPLATE_PREVIEWS_OUT === "1") {
          const preview = await render(harness.headless, projectPath, screen.id, PREVIEW_WIDTH / screen.artboard.width);
          const out = resolve(previewRoot, pack.id, `${screen.id.slice(pack.id.length + 1)}.png`);
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, preview);
        }
      }
    }
  }, 900_000);

  it("keeps copy 1.5× longer than the default inside every text box", async () => {
    const longer = (content: string) => `${content} ${content.slice(0, Math.ceil(content.length / 2)).trim()}`;
    const projectPath = writeProject("long", "en", "ltr", (leaf) => ({ content: longer(leaf.content) }));
    const overflows: string[] = [];
    for (const pack of packs) {
      for (const screen of pack.screens) {
        overflows.push(...(await overflowingText(projectPath, screen.id)).map((text) => `${screen.id}: ${text}`));
      }
    }
    expect(overflows).toEqual([]);
  }, 900_000);

  it("holds mirrored Arabic copy in a registered font, alike headed and headless", async () => {
    const projectPath = writeProject("ar", "ar", "rtl", (leaf) => ({
      content: ARABIC[leaf.role!], fontFamily: "Noto Sans Arabic", weight: 700, letterSpacing: 0,
    }));
    const overflows: string[] = [];
    for (const pack of packs) {
      for (const screen of pack.screens) {
        overflows.push(...(await overflowingText(projectPath, screen.id)).map((text) => `${screen.id}: ${text}`));
      }
      const hero = pack.screens[0]!.id;
      const headed = await render(harness.headed, projectPath, hero);
      const headless = await render(harness.headless, projectPath, hero);
      expect(mismatchFraction(headed, headless), hero).toBeLessThan(MAX_MISMATCH_FRACTION);
    }
    expect(overflows).toEqual([]);
  }, 900_000);
});
