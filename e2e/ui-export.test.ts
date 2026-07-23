// SPDX-License-Identifier: Apache-2.0
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "@screenshot-studio/core/export";
import { startWebServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/regressions/multi-locale-export");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const expectedPaths = [
  "apple/iphone/locale-en/01-english-one-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/01-arabic-one-6.9.png",
  "apple/iphone/locale-en/02-english-two-6.9.png",
  "apple/iphone/locale-~002e~002e~002far/02-arabic-two-6.9.png",
  "apple/ipad/locale-en/01-english-ipad-13.png",
  "android/phone/locale-en_~0055~0053/01-underscore-android-phone-portrait.png",
];

afterEach(() => {
  delete process.env.PROJECT_PATH;
  delete process.env.STORE_SPECS_PATH;
});

describe("multi-locale UI export", () => {
  it("exports safe per-group-numbered paths with exact dims and no alpha", async () => {
    // Copy the whole fixture (assets resolve relative to the project dir) into a temp workspace and
    // point the server's resolveProjectPath at it. Browser export must not publish beside the project.
    const workspace = await mkdtemp(join(tmpdir(), "ui-export-"));
    const operationId = `export_${randomBytes(16).toString("hex")}`;
    await cp(fixtureDir, workspace, { recursive: true });
    const projectPath = join(workspace, "app-store-screenshots.json");
    process.env.PROJECT_PATH = projectPath;
    process.env.STORE_SPECS_PATH = storeSpecsPath;

    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const expected = buildBundleEntries(project, project.preferredExportLayoutId, specs, {});
    expect(expected.map((entry) => entry.relativePath)).toEqual(expectedPaths);

    let server: Awaited<ReturnType<typeof startWebServer>> | undefined;
    try {
      server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
      const projectResponse = await fetch(`${server.url}/api/project`);
      expect(projectResponse.status).toBe(200);
      const projectId = projectResponse.headers.get("x-project-id");
      const revision = projectResponse.headers.get("etag");
      expect(projectId).toBeTruthy();
      expect(revision).toMatch(/^"[^"]+"$/);

      const exportRequest = fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": revision!,
          "x-project-id": projectId!,
        },
        body: JSON.stringify({ operationId }),
      });
      const observedProgress: Array<{ phase: string; completed: number; total: number }> = [];
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const progressResponse = await fetch(
          `${server.url}/api/export/progress?operationId=${operationId}`,
          { cache: "no-store" },
        );
        if (progressResponse.ok) {
          const progress = await progressResponse.json() as {
            phase: string;
            completed: number;
            total: number;
          };
          observedProgress.push(progress);
          if (progress.phase === "ready") break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      const res = await exportRequest;
      if (res.status !== 201) throw new Error(`UI export failed (${res.status}): ${await res.text()}`);
      expect(observedProgress.some((progress) => (
        progress.phase === "rendering" && progress.completed > 0 && progress.total === expected.length
      ))).toBe(true);
      expect(observedProgress.at(-1)?.phase).toBe("ready");
      const ticket = await res.json() as {
        downloadUrl: string;
        expiresAt: string;
        filename: string;
      };
      expect(ticket.downloadUrl).toMatch(/^\/api\/export\/artifacts\/[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(ticket.expiresAt)).toBeGreaterThan(Date.now());
      expect(ticket.filename).toBe("app-store-screenshots-bundle.zip");
      await expect(access(join(workspace, "export"))).rejects.toMatchObject({ code: "ENOENT" });

      const download = await fetch(new URL(ticket.downloadUrl, server.url));
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("application/zip");
      expect(download.headers.get("content-disposition"))
        .toBe('attachment; filename="app-store-screenshots-bundle.zip"');

      const zip = await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()));
      const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
      expect(names).toEqual([...expectedPaths].sort());

      for (const entry of expected) {
        const png = await zip.file(entry.relativePath)!.async("nodebuffer");
        const info = inspectPng(png);
        expect(info.width).toBe(entry.target.width);
        expect(info.height).toBe(entry.target.height);
        expect(info.hasAlpha).toBe(false);
      }

      const consumed = await fetch(new URL(ticket.downloadUrl, server.url));
      expect(consumed.status).toBe(404);
      expect(await consumed.json()).toEqual({ error: "Export artifact not found" });
    } finally {
      await server?.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  }, 180_000);
});
