// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "./route.js";

const storageHooks = vi.hoisted(() => ({
  beforeDestinationRevalidation: undefined as undefined | ((projectPath: string) => Promise<void>),
}));

vi.mock("@screenshot-studio/core/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@screenshot-studio/core/storage")>();
  return {
    ...actual,
    writeProjectConditionalAtomic: async (
      ...args: Parameters<typeof actual.writeProjectConditionalAtomic>
    ): ReturnType<typeof actual.writeProjectConditionalAtomic> => {
      const dependencies = args[3] ?? {};
      return actual.writeProjectConditionalAtomic(args[0], args[1], args[2], {
        ...dependencies,
        beforeDestinationRevalidation: async (projectPath) => {
          await dependencies.beforeDestinationRevalidation?.(projectPath);
          await storageHooks.beforeDestinationRevalidation?.(projectPath);
        },
      });
    },
  };
});

const validProject = {
  meta: { name: "T", schemaVersion: 1 },
  mode: "isolated",
  platforms: ["apple"], locales: ["en"], fonts: [],
  screens: [{
    id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  }],
};

let dir: string;
let file: string;

function quotedRevision(bytes: string | Buffer): string {
  return `"${createHash("sha256").update(bytes).digest("hex")}"`;
}

async function currentRevision(): Promise<string> {
  const response = await GET();
  expect(response.status).toBe(200);
  const revision = response.headers.get("etag");
  expect(revision).toBeTruthy();
  return revision!;
}

function putRequest(project: unknown, revision?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (revision) headers.set("if-match", revision);
  return new Request("http://x/api/project", {
    method: "PUT",
    headers,
    body: JSON.stringify(project),
  });
}

beforeEach(() => {
  storageHooks.beforeDestinationRevalidation = undefined;
  dir = mkdtempSync(join(tmpdir(), "proj-"));
  file = join(dir, "app-store-screenshots.json");
  writeFileSync(file, JSON.stringify(validProject));
  process.env.PROJECT_PATH = file;
});

afterEach(() => {
  storageHooks.beforeDestinationRevalidation = undefined;
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/project", () => {
  it("returns the parsed project and an ETag from the same exact bytes", async () => {
    const bytes = `${JSON.stringify(validProject, null, 4)}\n`;
    writeFileSync(file, bytes);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(quotedRevision(bytes));
    const body = await res.json();
    expect(body.meta.name).toBe("T");
    expect(body).toMatchObject({ mode: "isolated", meta: { schemaVersion: 1 } });
  });

  it("returns the ETag for canonical target bytes through a symlink project path", async () => {
    const alias = join(dir, "project-alias.json");
    const bytes = `${JSON.stringify(validProject, null, 4)}\n`;
    writeFileSync(file, bytes);
    symlinkSync(file, alias);
    process.env.PROJECT_PATH = alias;

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(quotedRevision(bytes));
    expect(lstatSync(alias).isSymbolicLink()).toBe(true);
    expect(realpathSync(alias)).toBe(realpathSync(file));
  });
});

describe("PUT /api/project", () => {
  it("returns 428 without changing bytes when If-Match is missing", async () => {
    const before = readFileSync(file);
    const next = structuredClone(validProject);
    next.meta.name = "Renamed";

    const res = await PUT(putRequest(next));

    expect(res.status).toBe(428);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(readFileSync(file)).toEqual(before);
  });

  it("writes with the GET ETag and returns the validated project with its new ETag", async () => {
    const revision = await currentRevision();
    const next = structuredClone(validProject);
    next.meta.name = "Renamed";

    const res = await PUT(putRequest(next, revision));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      mode: "isolated",
      meta: { name: "Renamed", schemaVersion: 1 },
    });
    const persistedBytes = readFileSync(file);
    expect(res.headers.get("etag")).toBe(quotedRevision(persistedBytes));
    expect(res.headers.get("etag")).not.toBe(revision);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      mode: "isolated",
      meta: { name: "Renamed", schemaVersion: 1 },
    });
  });

  it("writes through a symlink project path without replacing the symlink", async () => {
    const alias = join(dir, "project-alias.json");
    symlinkSync(file, alias);
    process.env.PROJECT_PATH = alias;
    const revision = await currentRevision();
    const next = structuredClone(validProject);
    next.meta.name = "Renamed through alias";

    const res = await PUT(putRequest(next, revision));

    expect(res.status).toBe(200);
    expect(lstatSync(alias).isSymbolicLink()).toBe(true);
    expect(realpathSync(alias)).toBe(realpathSync(file));
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      meta: { name: "Renamed through alias" },
    });
  });

  it("returns 412 and preserves a newer CLI snapshot byte-for-byte", async () => {
    const editorRevision = await currentRevision();
    const cliProject = structuredClone(validProject);
    cliProject.meta.name = "CLI change";
    const cliBytes = `${JSON.stringify(cliProject, null, 2)}\n`;
    writeFileSync(file, cliBytes);
    const editorProject = structuredClone(validProject);
    editorProject.meta.name = "Stale editor change";

    const res = await PUT(putRequest(editorProject, editorRevision));

    const actualRevision = quotedRevision(cliBytes);
    expect(res.status).toBe(412);
    await expect(res.json()).resolves.toEqual({
      error: expect.any(String),
      expectedRevision: editorRevision,
      actualRevision,
    });
    expect(readFileSync(file, "utf8")).toBe(cliBytes);
  });

  it("returns 412 when an atomic CLI-style write lands after If-Match comparison", async () => {
    const editorRevision = await currentRevision();
    const cliProject = structuredClone(validProject);
    cliProject.meta.name = "Post-compare CLI change";
    const cliBytes = `${JSON.stringify(cliProject, null, 2)}\n`;
    const editorProject = structuredClone(validProject);
    editorProject.meta.name = "Editor loser";
    storageHooks.beforeDestinationRevalidation = async (projectPath) => {
      const cliStage = join(dir, ".cli-stage.tmp");
      writeFileSync(cliStage, cliBytes);
      renameSync(cliStage, projectPath);
    };

    const res = await PUT(putRequest(editorProject, editorRevision));

    expect(res.status).toBe(412);
    await expect(res.json()).resolves.toEqual({
      error: expect.any(String),
      expectedRevision: editorRevision,
      actualRevision: quotedRevision(cliBytes),
    });
    expect(readFileSync(file, "utf8")).toBe(cliBytes);
  });

  it("returns structured JSON for a hard-linked project path", async () => {
    const hardLink = join(dir, "hard-link.json");
    linkSync(file, hardLink);
    process.env.PROJECT_PATH = hardLink;
    const before = readFileSync(file);
    const next = structuredClone(validProject);
    next.meta.name = "Rejected";

    const res = await PUT(putRequest(next, quotedRevision(before)));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/hard links/i) });
    expect(readFileSync(file)).toEqual(before);
  });

  it("returns structured JSON for a directory project path", async () => {
    process.env.PROJECT_PATH = dir;
    const before = readFileSync(file);
    const next = structuredClone(validProject);
    next.meta.name = "Rejected";

    const res = await PUT(putRequest(next, quotedRevision(before)));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/regular file/i) });
    expect(readFileSync(file)).toEqual(before);
  });

  it("returns structured JSON when the destination becomes a symlink before commit", async () => {
    const editorRevision = await currentRevision();
    const displaced = join(dir, "displaced.json");
    const outside = join(dir, "outside.json");
    const outsideBytes = `${JSON.stringify(validProject, null, 2)}\n`;
    writeFileSync(outside, outsideBytes);
    storageHooks.beforeDestinationRevalidation = async (projectPath) => {
      renameSync(projectPath, displaced);
      symlinkSync(outside, projectPath);
    };
    const next = structuredClone(validProject);
    next.meta.name = "Rejected";

    const res = await PUT(putRequest(next, editorRevision));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/symbolic link|no.follow/i),
    });
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe(outsideBytes);
  });

  it("rejects an invalid project with 400 and does not write", async () => {
    const revision = await currentRevision();
    const res = await PUT(putRequest({ meta: { name: "" } }, revision));
    expect(res.status).toBe(400);
    // original file untouched
    expect(JSON.parse(readFileSync(file, "utf8")).meta.name).toBe("T");
  });
});
