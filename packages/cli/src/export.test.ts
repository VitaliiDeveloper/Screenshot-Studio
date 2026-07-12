// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { inspectPng } from "@screenshot-studio/core/export";
import { exportBundle, writeBundleOutputs, type RenderedBundleEntry } from "./export.js";
import { renderStoreReadyPng } from "./store-ready-png.js";

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
    const outDir = await mkdtemp(join(tmpdir(), "bundle-export-"));
    const renderScreenToPng = vi.fn(async (_opts: { screenId: string }) => pngBytes());
    const zipPath = await exportBundle({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      outDir,
      entries,
      renderSession: { renderScreenToPng },
    });

    expect(renderScreenToPng).toHaveBeenCalledTimes(2);
    expect(renderScreenToPng.mock.calls.map(([opts]) => opts.screenId)).toEqual(["s1", "s2"]);
    await expect(stat(zipPath)).resolves.toBeTruthy();
    const written = await readFile(join(outDir, entries[0]!.relativePath));
    expect(inspectPng(written).hasAlpha).toBe(false);
  });

  it("wraps render errors with screen and target context", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-export-fail-"));
    const prior = join(outDir, entries[0]!.relativePath);
    await mkdir(dirname(prior), { recursive: true });
    await writeFile(prior, "prior");
    await expect(
      exportBundle({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        outDir,
        entries: [entries[0]!],
        renderSession: {
          renderScreenToPng: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      }),
    ).rejects.toThrow(/s1.*one.*boom/);
    expect(await readFile(prior, "utf8")).toBe("prior");
  });
});
