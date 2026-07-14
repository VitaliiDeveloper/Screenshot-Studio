// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { POST } from "./route.js";

const temporaryDirectories: string[] = [];

function completeProject(elements: unknown[] = []) {
  return {
    meta: { name: "Export route test", schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#111111" },
      elements,
    }],
  };
}

async function useProject(project = completeProject()): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "export-route-"));
  temporaryDirectories.push(directory);
  const projectPath = join(directory, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify(project));
  process.env.PROJECT_PATH = projectPath;
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("POST /api/export", () => {
  it("returns 422 without rendering when filters match no screens", async () => {
    await useProject();
    const res = await POST(req({ locale: "does-not-exist" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No screens match/);
  });

  it("returns 422 before rendering when text has no file-backed font", async () => {
    await useProject(completeProject([{
      id: "title", type: "text", x: 0, y: 0, width: 100, height: 100,
      content: "Title", fontFamily: "sans-serif", size: 24, color: "#FFFFFF",
    }]));

    const res = await POST(req({}));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/unresolved project fonts.*sans-serif/);
  });
});
