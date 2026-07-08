import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { inspectPng } from "@screenshot-studio/core/export";
import { exportBundle, writeBundleOutputs } from "./export.js";

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

describe("writeBundleOutputs", () => {
  it("writes PNG files and one zip with matching entries", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "bundle-output-"));
    const zipPath = await writeBundleOutputs({
      outDir,
      entries: [
        { entry: entries[0]!, png: pngBytes() },
        { entry: entries[1]!, png: pngBytes() },
      ],
    });

    await expect(stat(join(outDir, entries[0]!.relativePath))).resolves.toBeTruthy();
    await expect(stat(join(outDir, entries[1]!.relativePath))).resolves.toBeTruthy();

    const zip = await JSZip.loadAsync(await readFile(zipPath));
    expect(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.name).sort()).toEqual([
      "android/phone/uk/02-two-two.png",
      "apple/iphone/en/01-one-one.png",
    ]);
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
    await expect(
      exportBundle({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        outDir: await mkdtemp(join(tmpdir(), "bundle-export-fail-")),
        entries: [entries[0]!],
        renderSession: {
          renderScreenToPng: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      }),
    ).rejects.toThrow(/s1.*one.*boom/);
  });
});
