// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route.js";

let dir: string;
let projectFile: string;
let outsideDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asset-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, "{}");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  for (const ext of ["ttf", "otf", "woff", "woff2"]) {
    writeFileSync(join(dir, "assets", "fonts", `demo.${ext}`), Buffer.from([0x00, 0x01]));
  }
  process.env.PROJECT_PATH = projectFile;
  outsideDir = mkdtempSync(join(tmpdir(), "asset-outside-"));
});

afterEach(() => {
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

function req(qs: string): Request {
  return new Request(`http://x/api/asset?${qs}`);
}

describe("GET /api/asset", () => {
  it("serves a file under the project dir", async () => {
    const res = await GET(req("path=assets/shot.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89);
  });

  it("400s on a missing path param", async () => {
    expect((await GET(req(""))).status).toBe(400);
  });

  it("rejects path traversal outside the base dir", async () => {
    expect((await GET(req("path=../../etc/passwd"))).status).toBe(400);
  });

  it("rejects a symlink escape outside the project", async () => {
    const outside = join(outsideDir, "outside.png");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(dir, "assets", "escape.png"));
    expect((await GET(req("path=assets/escape.png"))).status).toBe(400);
  });

  it("404s a nonexistent file", async () => {
    expect((await GET(req("path=assets/nope.png"))).status).toBe(404);
  });

  it("serves font files with font content types", async () => {
    expect((await GET(req("path=assets/fonts/demo.ttf"))).headers.get("content-type")).toContain("font/ttf");
    expect((await GET(req("path=assets/fonts/demo.otf"))).headers.get("content-type")).toContain("font/otf");
    expect((await GET(req("path=assets/fonts/demo.woff"))).headers.get("content-type")).toContain("font/woff");
    expect((await GET(req("path=assets/fonts/demo.woff2"))).headers.get("content-type")).toContain("font/woff2");
  });
});
