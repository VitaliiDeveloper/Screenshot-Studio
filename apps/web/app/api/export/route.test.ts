import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POST } from "./route.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const fixture = resolve(repoRoot, "fixtures/phase-2-bundle/app-store-screenshots.json");

function req(body: unknown): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.PROJECT_PATH;
});

describe("POST /api/export", () => {
  it("returns 422 without rendering when filters match no screens", async () => {
    process.env.PROJECT_PATH = fixture;
    const res = await POST(req({ locale: "does-not-exist" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No screens match/);
  });

  it("returns 422 before rendering when text has no file-backed font", async () => {
    const dir = await mkdtemp(join(tmpdir(), "unresolved-font-export-"));
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeFile(projectPath, JSON.stringify({
      meta: { name: "T", schemaVersion: 1 }, platforms: ["apple"], locales: ["en"], fonts: [],
      screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "title", type: "text", x: 0, y: 0, width: 100, height: 100, content: "Title", fontFamily: "sans-serif", size: 24, color: "#FFFFFF" }] }],
    }));
    process.env.PROJECT_PATH = projectPath;

    const res = await POST(req({}));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/unresolved project fonts.*sans-serif/);
  });
});
