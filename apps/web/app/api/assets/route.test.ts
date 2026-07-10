// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "assets-route-"));
  process.env.PROJECT_PATH = join(directory, "app-store-screenshots.json");
  await writeFile(process.env.PROJECT_PATH, "{}");
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "assets", "shot.png"), "image");
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe("GET /api/assets", () => {
  it("returns safe project image descriptors", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assets: [{ path: "assets/shot.png", name: "shot.png", source: "assets" }],
    });
  });
});
