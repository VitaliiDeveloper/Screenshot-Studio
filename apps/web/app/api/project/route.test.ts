import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "./route.js";

const validProject = {
  meta: { name: "T", schemaVersion: 1 },
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "proj-"));
  file = join(dir, "app-store-screenshots.json");
  writeFileSync(file, JSON.stringify(validProject));
  process.env.PROJECT_PATH = file;
});

afterEach(() => {
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/project", () => {
  it("returns the parsed project", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.name).toBe("T");
  });
});

describe("PUT /api/project", () => {
  it("validates and writes a valid project to disk", async () => {
    const next = structuredClone(validProject);
    next.meta.name = "Renamed";
    const res = await PUT(new Request("http://x/api/project", {
      method: "PUT", body: JSON.stringify(next),
    }));
    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8")).meta.name).toBe("Renamed");
  });

  it("rejects an invalid project with 400 and does not write", async () => {
    const res = await PUT(new Request("http://x/api/project", {
      method: "PUT", body: JSON.stringify({ meta: { name: "" } }),
    }));
    expect(res.status).toBe(400);
    // original file untouched
    expect(JSON.parse(readFileSync(file, "utf8")).meta.name).toBe("T");
  });
});
