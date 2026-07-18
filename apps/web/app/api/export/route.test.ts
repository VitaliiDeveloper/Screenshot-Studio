// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "../../../lib/project-session.server.js";
import { handleExportPost } from "./handler.js";
import { POST } from "./route.js";

const temporaryDirectories: string[] = [];
const originalInitCwd = process.env.INIT_CWD;

function completeProject(elements: unknown[] = []) {
  return {
    meta: { name: "Export route test", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#111111" },
        elements,
      }],
    }],
  };
}

async function useProject(project = completeProject()): Promise<{ directory: string; projectPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "export-route-"));
  temporaryDirectories.push(directory);
  const projectPath = join(directory, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify(project));
  return { directory, projectPath };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sessionReq(
  projectPath: string,
  body: unknown,
  override: { projectId?: string; revision?: string } = {},
): Promise<Request> {
  const session = await projectSessionRegistry.openLocal(projectPath);
  const revision = projectRevision(await readFile(projectPath));
  process.env.PROJECT_PATH = join(dirname(projectPath), "configured-missing.json");
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`,
      "if-match": override.revision ?? `"${revision}"`,
      "x-project-id": override.projectId ?? session.projectId,
    },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  if (originalInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = originalInitCwd;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("POST /api/export", () => {
  it("rejects a stale expected revision inside the stable export lease", async () => {
    const { directory, projectPath } = await useProject();
    const zipPath = join(directory, "bundle.zip");
    await writeFile(zipPath, "zip bytes");
    const exportBundle = vi.fn(async () => zipPath);

    const response = await handleExportPost(projectPath, req({}), {
      createRenderBrowserSession: vi.fn(async () => ({
        renderScreenToPng: vi.fn(),
        close: vi.fn(async () => undefined),
      })),
      exportBundle,
    }, "stale-revision");

    expect(response.status).toBe(412);
    expect(exportBundle).not.toHaveBeenCalled();
  });

  it("treats valid non-object JSON as an unfiltered request", async () => {
    const { directory, projectPath } = await useProject();
    const zipPath = join(directory, "bundle.zip");
    await writeFile(zipPath, "zip bytes");
    const exportBundle = vi.fn(async () => zipPath);

    const response = await handleExportPost(projectPath, req(null), {
      createRenderBrowserSession: vi.fn(async () => ({
        renderScreenToPng: vi.fn(),
        close: vi.fn(async () => undefined),
      })),
      exportBundle,
      stageExportArtifact: vi.fn(async (_source, outputDir) => ({
        downloadUrl: `/api/export/artifacts/${"a".repeat(43)}`,
        outputDir,
        expiresAt: "2026-07-15T00:05:00.000Z",
      })),
    });

    expect(response.status).toBe(201);
    expect(exportBundle).toHaveBeenCalledOnce();
  });

  it("returns a one-shot artifact ticket without placing archive bytes in the POST response", async () => {
    const { directory, projectPath } = await useProject();
    const zipPath = join(directory, "bundle.zip");
    await writeFile(zipPath, "zip bytes that must not be returned here");
    const session = { renderScreenToPng: vi.fn(), close: vi.fn(async () => undefined) };
    const stageExportArtifact = vi.fn(async (_sourceZipPath: string, outputDir: string) => ({
      downloadUrl: `/api/export/artifacts/${"a".repeat(43)}`,
      outputDir,
      expiresAt: "2026-07-15T00:05:00.000Z",
    }));

    const response = await handleExportPost(projectPath, req({}), {
      createRenderBrowserSession: vi.fn(async () => session),
      exportBundle: vi.fn(async () => zipPath),
      stageExportArtifact,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("x-export-dir")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({
      downloadUrl: `/api/export/artifacts/${"a".repeat(43)}`,
      outputDir: expect.stringMatching(/\/export$/),
      expiresAt: "2026-07-15T00:05:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain(zipPath);
    expect(stageExportArtifact).toHaveBeenCalledWith(zipPath, expect.stringMatching(/\/export$/));
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("stages the exact archive before browser cleanup can expose the path to replacement", async () => {
    const { directory, projectPath } = await useProject();
    const zipPath = join(directory, "bundle.zip");
    await writeFile(zipPath, "request-owned zip bytes");
    let stagedBytes = "";
    const session = {
      renderScreenToPng: vi.fn(),
      close: vi.fn(async () => { await writeFile(zipPath, "replacement zip bytes"); }),
    };

    const response = await handleExportPost(projectPath, req({}), {
      createRenderBrowserSession: vi.fn(async () => session),
      exportBundle: vi.fn(async () => zipPath),
      stageExportArtifact: vi.fn(async (source, outputDir) => {
        stagedBytes = await readFile(source, "utf8");
        return {
          downloadUrl: `/api/export/artifacts/${"a".repeat(43)}`,
          outputDir,
          expiresAt: "2026-07-15T00:05:00.000Z",
        };
      }),
    });

    expect(response.status).toBe(201);
    expect(stagedBytes).toBe("request-owned zip bytes");
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("returns a structured 500 when artifact staging fails", async () => {
    const { directory, projectPath } = await useProject();
    const zipPath = join(directory, "bundle.zip");
    await writeFile(zipPath, "zip bytes");
    const session = { renderScreenToPng: vi.fn(), close: vi.fn(async () => undefined) };

    const response = await handleExportPost(projectPath, req({}), {
      createRenderBrowserSession: vi.fn(async () => session),
      exportBundle: vi.fn(async () => zipPath),
      stageExportArtifact: vi.fn(async () => { throw new Error("artifact staging failed"); }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/artifact staging failed/);
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("returns a structured error when a successful export cannot close its browser session", async () => {
    const { directory, projectPath } = await useProject();
    const zipPath = join(directory, "bundle.zip");
    await writeFile(zipPath, "zip bytes");
    const closeError = new Error("browser close failed");
    const session = {
      renderScreenToPng: vi.fn(),
      close: vi.fn(async () => { throw closeError; }),
    };

    const response = await handleExportPost(projectPath, req({}), {
      createRenderBrowserSession: vi.fn(async () => session),
      exportBundle: vi.fn(async () => zipPath),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/browser close failed/);
  });

  it("aggregates export and browser cleanup failures in one structured response", async () => {
    const { projectPath } = await useProject();
    const exportError = new Error("render failed");
    const closeError = new Error("browser close failed");
    const session = {
      renderScreenToPng: vi.fn(),
      close: vi.fn(async () => { throw closeError; }),
    };

    const response = await handleExportPost(projectPath, req({}), {
      createRenderBrowserSession: vi.fn(async () => session),
      exportBundle: vi.fn(async () => { throw exportError; }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/render failed.*browser cleanup failed.*browser close failed/);
  });

  it("returns 422 without rendering when filters match no screens", async () => {
    const { projectPath } = await useProject();
    const res = await POST(await sessionReq(projectPath, { locale: "does-not-exist" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No screens match/);
  });

  it("returns 422 before rendering when text has no file-backed font", async () => {
    const { projectPath } = await useProject(completeProject([{
      id: "title", type: "text", x: 0, y: 0, width: 100, height: 100,
      content: "Title", fontFamily: "sans-serif", size: 24, color: "#FFFFFF",
    }]));

    const res = await POST(await sessionReq(projectPath, {}));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/unresolved project fonts.*sans-serif/);
  });

  it("rejects stale project identity and revision before export validation", async () => {
    const { projectPath } = await useProject();

    const staleProject = await POST(await sessionReq(
      projectPath,
      { locale: "does-not-exist" },
      { projectId: "stale-project" },
    ));
    expect(staleProject.status).toBe(409);

    const staleRevision = await POST(await sessionReq(
      projectPath,
      { locale: "does-not-exist" },
      { revision: '"stale-revision"' },
    ));
    expect(staleRevision.status).toBe(412);
  });

  it("returns 409 without a session before creating export resources or changing the revision", async () => {
    delete process.env.PROJECT_PATH;
    const { directory, projectPath } = await useProject();
    process.env.INIT_CWD = directory;
    const before = await readFile(projectPath);

    const response = await POST(req({}));

    expect(response.status).toBe(409);
    expect(projectRevision(await readFile(projectPath))).toBe(projectRevision(before));
    await expect(readFile(join(directory, "export", "bundle.zip"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
