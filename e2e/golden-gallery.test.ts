// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createRenderBrowserSession, type RenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";
import {
  leadStoreSizeId,
  listStoreTargets,
  parseStoreSpecs,
  safeStoreSizePathToken,
  stripAlpha,
} from "@screenshot-studio/core/export";
import { ensureStoreTargetVariant, getLayout, parseProject, type Project, type Screen } from "@screenshot-studio/core/model";
import { createScreensFromTemplatePack, listBuiltInTemplatePacks, type TemplatePack } from "@screenshot-studio/core/templates";
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";

/**
 * Golden gallery: the first screen of every built-in screen pack (each baked from a built-in design
 * pack), at every store size of its family, in LTR and Arabic RTL, rendered through the real render
 * host and compared with references. References are per platform because CoreText and FreeType
 * rasterize text edges differently; only Linux (CI) references are tracked. GOLDEN_UPDATE=1 rewrites
 * only references whose pixels changed beyond the threshold; the check never writes references and
 * leaves every render under test-results/golden-gallery/actual/ in the reference layout.
 */

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const specsPath = resolve(repoRoot, "store-specs.json");
const storeSpecs = parseStoreSpecs(JSON.parse(readFileSync(specsPath, "utf8")));
const goldenRoot = resolve(repoRoot, "e2e/golden", process.platform);
const outRoot = resolve(repoRoot, "test-results/golden-gallery");
const UPDATE = process.env.GOLDEN_UPDATE === "1";
const LONG_SIDE = 288;
const MAX_MISMATCH_FRACTION = 0.001;
const DIRECTIONS = [{ direction: "ltr", locale: "en" }, { direction: "rtl", locale: "ar" }] as const;
const packs = listBuiltInTemplatePacks(storeSpecs);

let server: RunningServer;
let session: RenderBrowserSession;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(resolve(tmpdir(), "golden-gallery-"));
  rmSync(outRoot, { recursive: true, force: true });
  server = await startWebServer(undefined, { storeSpecsPath: specsPath });
  session = await createRenderBrowserSession();
}, 180_000);

afterAll(async () => {
  await session?.close();
  await server?.stop();
  rmSync(root, { recursive: true, force: true });
});

/** One project per pack and direction: the pack's screens plus a size variant of its first screen per target. */
function writePackProject(pack: TemplatePack, locale: string, direction: Screen["direction"]): { projectPath: string; cases: { sizeId: string; screen: Screen }[] } {
  // New screens take the direction of the layout's existing screens in their locale.
  const seed: Screen = {
    id: "seed", name: "Seed", platform: "apple", device: "iphone", locale, direction,
    artboard: { width: 1206, height: 2622 }, background: { type: "solid", color: "#000000" }, elements: [],
  };
  const empty: Project = {
    meta: { name: pack.id, schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Default", mode: pack.panorama ? "connected" : "isolated", screens: [seed] }],
  };
  let project = createScreensFromTemplatePack(empty, "default", pack, locale, storeSpecs).project;
  const layout = getLayout(project, "default");
  project = { ...project, layouts: [{ ...layout, screens: layout.screens.filter((screen) => screen.id !== "seed") }] };
  const first = getLayout(project, "default").screens[0]!;
  const lead = leadStoreSizeId(storeSpecs, pack.platform, pack.device);
  const cases = listStoreTargets(storeSpecs, pack.platform, pack.device).map((target) => {
    if (target.id === lead) return { sizeId: target.id, screen: first };
    const result = ensureStoreTargetVariant(project, "default", first.id, target);
    project = result.project;
    return { sizeId: target.id, screen: result.variant };
  });
  const dir = resolve(root, `${pack.id}-${locale}`);
  mkdirSync(dir, { recursive: true });
  const projectPath = resolve(dir, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify(parseProject(project)));
  return { projectPath, cases };
}

function mismatchFraction(actual: PNG, expected: PNG, diff: PNG): number {
  const mismatch = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
  return mismatch / (actual.width * actual.height);
}

function writePng(path: string, png: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".png"));
}

describe("golden gallery", () => {
  it("covers every built-in design pack through a screen pack", () => {
    expect(new Set(packs.map((pack) => pack.style))).toEqual(new Set(listBuiltInDesignPacks().map((pack) => pack.id)));
  });

  it("renders every pack, store size, and direction like its reference", async () => {
    const failures: string[] = [];
    const written: string[] = [];
    const expected = new Set<string>();
    const seeded = existsSync(goldenRoot);
    for (const pack of packs) {
      for (const { direction, locale } of DIRECTIONS) {
        const { projectPath, cases } = writePackProject(pack, locale, direction);
        for (const { sizeId, screen } of cases) {
          expect(screen.direction, `${pack.id} ${locale}`).toBe(direction);
          const name = `${pack.id}/${safeStoreSizePathToken(sizeId)}-${direction}.png`;
          const triple = `${pack.id} ${sizeId} ${direction}`;
          expected.add(name);
          const pixelRatio = LONG_SIDE / Math.max(screen.artboard.width, screen.artboard.height);
          let actualPng: Buffer;
          try {
            actualPng = stripAlpha(await session.renderScreenToPng({
              baseUrl: server.url, projectPath, layoutId: "default", screenId: screen.id, pixelRatio, timeoutMs: 60_000,
            }));
          } catch (error) {
            failures.push(`${pack.id}/${sizeId}-${direction}: render failed: ${(error as Error).message}`);
            continue;
          }
          if (!UPDATE) writePng(resolve(outRoot, "actual", name), actualPng);
          if (!UPDATE && !seeded) continue;
          const referencePath = resolve(goldenRoot, name);
          const reference = existsSync(referencePath) ? readFileSync(referencePath) : undefined;
          let problem: string | undefined;
          let diff: PNG | undefined;
          if (!reference) {
            problem = "missing reference";
          } else {
            const actual = PNG.sync.read(actualPng);
            const expectedPng = PNG.sync.read(reference);
            if (actual.width !== expectedPng.width || actual.height !== expectedPng.height) {
              problem = `size ${actual.width}×${actual.height}, reference ${expectedPng.width}×${expectedPng.height}`;
            } else {
              diff = new PNG({ width: actual.width, height: actual.height });
              const fraction = mismatchFraction(actual, expectedPng, diff);
              if (fraction >= MAX_MISMATCH_FRACTION) problem = `${(fraction * 100).toFixed(3)}% pixels differ`;
            }
          }
          if (!problem) continue;
          if (UPDATE) {
            writePng(referencePath, actualPng);
            written.push(`${triple}: ${problem}`);
            continue;
          }
          failures.push(`${triple}: ${problem}`);
          const base = resolve(outRoot, "diff", name.replace(/\.png$/, ""));
          if (reference) writePng(`${base}.expected.png`, reference);
          if (diff) writePng(`${base}.diff.png`, PNG.sync.write(diff));
        }
      }
    }
    if (!UPDATE && !seeded) {
      failures.push(
        `No ${process.platform} golden references in ${relative(repoRoot, goldenRoot)}. Run \`pnpm golden:update\` `
        + `to seed them locally (only e2e/golden/linux/ is tracked); this run's renders are in ${relative(repoRoot, outRoot)}/actual/.`,
      );
    }
    for (const stale of listPngs(goldenRoot).filter((path) => !expected.has(path.split("\\").join("/")))) {
      if (UPDATE) {
        rmSync(resolve(goldenRoot, stale));
        written.push(`${stale}: removed stale reference`);
      } else {
        failures.push(`${stale}: stale reference with no case`);
      }
    }
    if (UPDATE) {
      // Not console.log: Vitest's agent reporter drops console output from passing tests.
      process.stdout.write(written.length
        ? `Golden references updated in ${relative(repoRoot, goldenRoot)}:\n${written.join("\n")}\n`
        : "Golden references unchanged.\n");
    }
    expect(failures, `See ${relative(repoRoot, outRoot)}/diff/ for expected and diff PNGs, actual/ for every render`).toEqual([]);
  }, 3_600_000);
});
