// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { inspectPng } from "@screenshot-studio/core/export";
import {
  exportBundle,
  withStableProjectExport,
  writeBundleOutputs,
  type RenderedBundleEntry,
} from "./export.js";
import type { RenderOptions } from "./render-driver.js";
import { renderStoreReadyPng } from "./store-ready-png.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWPgEpFrAAABJQC9HDa67AAAAABJRU5ErkJggg==",
    "base64",
  );
}

const entries = [
  {
    screen: { id: "s1", artboard: { width: 1, height: 1 } },
    target: { id: "one", width: 1, height: 1 },
    relativePath: "apple/iphone/en/01-one-one.png",
  },
  {
    screen: { id: "s2", artboard: { width: 1, height: 1 } },
    target: { id: "two", width: 1, height: 1 },
    relativePath: "android/phone/uk/02-two-two.png",
  },
] as unknown as BundleEntry[];

describe("renderStoreReadyPng", () => {
  it("renders at the calculated ratio and returns an exact alpha-free target", async () => {
    const raw = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    }).png().toBuffer();
    const render = vi.fn(async (_pixelRatio: number) => raw);
    expect(inspectPng(raw).hasAlpha).toBe(true);

    const png = await renderStoreReadyPng({
      screen: { artboard: { width: 1, height: 1 } },
      target: { width: 2, height: 2 },
      render,
    });

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(2);
    expect(inspectPng(png)).toEqual({ width: 2, height: 2, hasAlpha: false });
    const flattened = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(flattened.info.channels).toBe(3);
    expect([...flattened.data.subarray(0, 3)]).toEqual([137, 147, 157]);
  });

  it("rejects rendered PNG dimensions that do not match the target", async () => {
    await expect(renderStoreReadyPng({
      screen: { artboard: { width: 1, height: 1 } },
      target: { width: 2, height: 2 },
      render: vi.fn(async () => pngBytes()),
    })).rejects.toThrow(/Export dimension mismatch: got 1×1, expected 2×2/);
  });
});

describe("public export module", () => {
  it("retains the bundle publisher function and entry type", () => {
    const renderedEntry: RenderedBundleEntry = { entry: entries[0]!, png: pngBytes() };

    expect(writeBundleOutputs).toBeTypeOf("function");
    expect(renderedEntry.entry).toBe(entries[0]);
  });
});

describe("exportBundle", () => {
  it("renders entries through one session and writes store-ready outputs", async () => {
    const outDir = await workspace("bundle-export-");
    const renderScreenToPng = vi.fn(async (_opts: RenderOptions) => pngBytes());
    let publicationGuardCalls = 0;
    const publicationGuard = async <T>(publish: () => Promise<T>): Promise<T> => {
      publicationGuardCalls += 1;
      return publish();
    };
    const progress: Array<{ phase: string; completed: number; total: number }> = [];
    const zipPath = await exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      projectRevision: "a".repeat(64),
      layoutId: "default",
      outDir,
      entries,
      renderSession: { renderScreenToPng },
      publicationGuard,
      onProgress: (event) => progress.push(event),
    });

    expect(renderScreenToPng).toHaveBeenCalledTimes(2);
    expect(renderScreenToPng.mock.calls.map(([opts]) => opts.screenId)).toEqual(["s1", "s2"]);
    expect(renderScreenToPng.mock.calls.map(([opts]) => opts.projectRevision))
      .toEqual(["a".repeat(64), "a".repeat(64)]);
    expect(publicationGuardCalls).toBe(1);
    expect(progress).toEqual([
      { phase: "rendering", completed: 0, total: 2 },
      { phase: "rendering", completed: 1, total: 2 },
      { phase: "rendering", completed: 2, total: 2 },
      { phase: "packaging", completed: 2, total: 2 },
    ]);
    await expect(stat(zipPath)).resolves.toBeTruthy();
    const written = await readFile(join(outDir, entries[0]!.relativePath));
    expect(inspectPng(written).hasAlpha).toBe(false);
  });

  it("wraps render errors with screen and target context", async () => {
    const outDir = await workspace("bundle-export-fail-");
    const prior = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(prior), { recursive: true });
    await writeFile(prior, "prior");
    await expect(
      exportBundle({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        projectRevision: "b".repeat(64),
        layoutId: "default",
        outDir,
        entries: [entries[0]!],
        publicationGuard: async (publish) => publish(),
        renderSession: {
          renderScreenToPng: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      }),
    ).rejects.toThrow(/s1.*one.*boom/);
    expect(await readFile(prior, "utf8")).toBe("prior");
  });

  it("skips a failed entry when the caller collects per-file errors", async () => {
    const outDir = await workspace("bundle-export-partial-");
    const failures: Array<{ screenId: string; message: string }> = [];
    const progress: Array<{ phase: string; completed: number; total: number }> = [];
    const zipPath = await exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      projectRevision: "d".repeat(64),
      layoutId: "default",
      outDir,
      entries,
      publicationGuard: async (publish) => publish(),
      renderSession: {
        renderScreenToPng: vi.fn(async (opts: RenderOptions) => {
          if (opts.screenId === "s1") throw new Error("font file could not be read");
          return pngBytes();
        }),
      },
      onEntryError: (entry, message) => failures.push({ screenId: entry.screen.id, message }),
      onProgress: (event) => progress.push(event),
    });

    expect(failures).toEqual([{ screenId: "s1", message: "font file could not be read" }]);
    expect(progress.at(-2)).toEqual({ phase: "rendering", completed: 2, total: 2 });
    await expect(readFile(join(outDir, entries[0]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(outDir, entries[1]!.relativePath))).resolves.toBeTruthy();
    await expect(stat(zipPath)).resolves.toBeTruthy();
  });

  it("packages only the files rendered before a stop", async () => {
    const outDir = await workspace("bundle-export-stop-");
    let stop = false;
    const renderScreenToPng = vi.fn(async () => {
      stop = true;
      return pngBytes();
    });
    await exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      projectRevision: "e".repeat(64),
      layoutId: "default",
      outDir,
      entries,
      publicationGuard: async (publish) => publish(),
      renderSession: { renderScreenToPng },
      shouldStop: () => stop,
    });

    expect(renderScreenToPng).toHaveBeenCalledTimes(1);
    await expect(readFile(join(outDir, entries[0]!.relativePath))).resolves.toBeTruthy();
    await expect(readFile(join(outDir, entries[1]!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes nothing when stopped before the first file", async () => {
    const outDir = await workspace("bundle-export-stop-empty-");
    await expect(exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      projectRevision: "f".repeat(64),
      layoutId: "default",
      outDir,
      entries,
      publicationGuard: async (publish) => publish(),
      renderSession: { renderScreenToPng: vi.fn(async () => pngBytes()) },
      shouldStop: () => true,
    })).rejects.toThrow("Export stopped before any file was rendered");
    await expect(readFile(join(outDir, "app-store-screenshots-bundle.zip")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks the final project revision before publishing any rendered output", async () => {
    const outDir = await workspace("bundle-export-revision-fail-");
    const revisionFailure = new Error("project revision changed");

    await expect(exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      projectRevision: "c".repeat(64),
      layoutId: "default",
      outDir,
      entries: [entries[0]!],
      renderSession: { renderScreenToPng: vi.fn(async () => pngBytes()) },
      publicationGuard: async <T>(_publish: () => Promise<T>): Promise<T> => {
        throw revisionFailure;
      },
    })).rejects.toBe(revisionFailure);

    await expect(readFile(join(outDir, entries[0]!.relativePath)))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(outDir, "app-store-screenshots-bundle.zip")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("withStableProjectExport", () => {
  async function projectFixture(): Promise<{ path: string; bytes: string }> {
    const root = await workspace("stable-project-export-");
    const path = join(root, "app-store-screenshots.json");
    const bytes = `${JSON.stringify({
      meta: { name: "Stable", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "default",
      layouts: [{
        id: "default",
        name: "Default",
        mode: "isolated",
        screens: [{
          id: "hero",
          name: "Hero",
          platform: "apple",
          device: "iphone",
          locale: "en",
          direction: "ltr",
          artboard: { width: 660, height: 1434 },
          background: { type: "solid", color: "#111111" },
          elements: [],
        }],
      }],
    })}\n`;
    await writeFile(path, bytes, "utf8");
    return { path, bytes };
  }

  it("publishes only after revalidating the exact snapshot under its project lease", async () => {
    const fixture = await projectFixture();
    const events: string[] = [];

    await expect(withStableProjectExport(fixture.path, async (context) => {
      events.push(`render:${context.project.meta.name}`);
      return context.publish(async () => {
        events.push("publish");
        return context.revision;
      });
    })).resolves.toMatch(/^[a-f0-9]{64}$/);

    expect(events).toEqual(["render:Stable", "publish"]);
  });

  it("rejects changed bytes before calling the publication callback", async () => {
    const fixture = await projectFixture();
    let published = false;

    await expect(withStableProjectExport(fixture.path, async (context) => {
      await writeFile(fixture.path, fixture.bytes.replace("Stable", "Changed"), "utf8");
      return context.publish(async () => {
        published = true;
      });
    })).rejects.toThrow(/revision.*changed/i);

    expect(published).toBe(false);
  });

  it("rejects an atomic same-byte project replacement before publication", async () => {
    const fixture = await projectFixture();
    const replacement = `${fixture.path}.replacement`;
    let published = false;

    await expect(withStableProjectExport(fixture.path, async (context) => {
      await writeFile(replacement, fixture.bytes, "utf8");
      await rename(replacement, fixture.path);
      return context.publish(async () => {
        published = true;
      });
    })).rejects.toThrow(/identity.*changed/i);

    expect(published).toBe(false);
  });

  it("invalidates a publication guard after the export callback has settled", async () => {
    const fixture = await projectFixture();
    const exportFailure = new Error("render host exited");
    let publish!: Parameters<Parameters<typeof withStableProjectExport>[1]>[0]["publish"];

    await expect(withStableProjectExport(fixture.path, async (context) => {
      publish = context.publish;
      throw exportFailure;
    })).rejects.toBe(exportFailure);

    let publicationCalled = false;
    await expect(publish(async () => {
      publicationCalled = true;
    })).rejects.toThrow(/lease.*active/i);
    expect(publicationCalled).toBe(false);
  });

  it("keeps the project lease until an already-started publication settles", async () => {
    const fixture = await projectFixture();
    const exportFailure = new Error("render host exited");
    let releasePublication!: () => void;
    let reportPublicationStarted!: () => void;
    const publicationStarted = new Promise<void>((resolveStarted) => {
      reportPublicationStarted = resolveStarted;
    });
    const publicationGate = new Promise<void>((resolvePublication) => {
      releasePublication = resolvePublication;
    });
    let publication!: Promise<void>;
    let exportSettled = false;

    const exportResult = withStableProjectExport(fixture.path, async (context) => {
      publication = context.publish(async () => {
        reportPublicationStarted();
        await publicationGate;
      });
      await publicationStarted;
      throw exportFailure;
    });
    void exportResult.finally(() => { exportSettled = true; }).catch(() => undefined);

    await publicationStarted;
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    expect(exportSettled).toBe(false);

    releasePublication();
    await expect(publication).resolves.toBeUndefined();
    await expect(exportResult).rejects.toBe(exportFailure);
  });
});
