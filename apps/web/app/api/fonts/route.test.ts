// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleFontDelete, handleFontGet, handleFontPost } from "./handler.js";

const validProject = {
  meta: { name: "Fonts", schemaVersion: 1 },
  platforms: ["apple"], locales: ["en"], fonts: [],
  screens: [{
    id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#111111" }, elements: [],
  }],
};

let dir: string;
let projectPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "font-route-"));
  projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify(validProject));
  process.env.PROJECT_PATH = projectPath;
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  await rm(dir, { recursive: true, force: true });
});

function uploadRequest(family = "Inter", weight = "700"): Request {
  const form = new FormData();
  form.set("family", family);
  form.set("weight", weight);
  form.set("file", new Blob(["font-bytes"]), "Inter.ttf");
  return new Request("http://localhost/api/fonts", { method: "POST", body: form });
}

describe("/api/fonts", () => {
  it("uploads, lists, and removes a custom font", async () => {
    const added = await handleFontPost(uploadRequest());
    expect(added.status).toBe(201);
    expect((await added.json()).fonts).toEqual([
      { family: "Inter", weight: 700, source: "uploaded", path: "assets/fonts/inter-700.ttf" },
    ]);
    expect(await readFile(join(dir, "assets/fonts/inter-700.ttf"), "utf8")).toBe("font-bytes");

    const listed = await handleFontGet();
    expect((await listed.json()).fonts).toHaveLength(1);

    const removed = await handleFontDelete(new Request("http://localhost/api/fonts", {
      method: "DELETE",
      body: JSON.stringify({ family: "Inter", weight: 700 }),
    }));
    expect(removed.status).toBe(200);
    expect((await removed.json()).fonts).toEqual([]);
  });

  it("materializes a Google font server-side at add-time", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/inter.ttf); }"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const response = await handleFontPost(new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "google", family: "Inter", weight: 400 }),
    }), { fetch });

    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readFile(join(dir, "assets/fonts/inter-400.ttf"))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("rejects invalid uploads and duplicate identities", async () => {
    const invalid = new FormData();
    invalid.set("family", "Inter");
    invalid.set("weight", "400");
    invalid.set("file", new Blob(["x"]), "Inter.txt");
    expect((await handleFontPost(new Request("http://localhost/api/fonts", { method: "POST", body: invalid }))).status)
      .toBe(400);

    expect((await handleFontPost(uploadRequest("Inter", "400"))).status).toBe(201);
    expect((await handleFontPost(uploadRequest("Inter", "400"))).status).toBe(409);
  });

  it("maps typed validation and Google materialization errors to explicit 4xx responses", async () => {
    const invalidSource = await handleFontPost(new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "system", family: "Inter", weight: 400 }),
    }));
    expect(invalidSource.status).toBe(400);

    const invalidJson = await handleFontPost(new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    expect(invalidJson.status).toBe(400);

    const noFontUrl = await handleFontPost(new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "google", family: "Inter", weight: 400 }),
    }), { fetch: vi.fn().mockResolvedValue(new Response("body {}")) });
    expect(noFontUrl.status).toBe(422);
  });
});
