// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "../../../lib/project-session.server.js";
import { handleFontDelete, handleFontGet, handleFontPost } from "./handler.js";
import { DELETE, GET, POST } from "./route.js";

const validProject = {
  meta: { name: "Fonts", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#111111" }, elements: [],
    }],
  }],
};

let dir: string;
let projectPath: string;
let validTtf: Buffer;
const originalInitCwd = process.env.INIT_CWD;

beforeAll(async () => {
  validTtf = await readFile(new URL("../../../../../fixtures/sample/assets/fonts/Pacifico-Regular.ttf", import.meta.url));
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "font-route-"));
  projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify(validProject));
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  if (originalInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = originalInitCwd;
  await rm(dir, { recursive: true, force: true });
});

function uploadRequest(family = "Inter", weight = "700"): Request {
  const form = new FormData();
  form.set("family", family);
  form.set("weight", weight);
  form.set("file", new Blob([new Uint8Array(validTtf)]), "Inter.ttf");
  return new Request("http://localhost/api/fonts", { method: "POST", body: form });
}

function sessionRequest(sessionId: string, method = "GET", body?: BodyInit): Request {
  return new Request("http://localhost/api/fonts", {
    method,
    headers: { cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}` },
    body,
  });
}

describe("/api/fonts", () => {
  it("uploads, lists, and removes a custom font", async () => {
    const added = await handleFontPost(projectPath, uploadRequest());
    expect(added.status).toBe(201);
    expect(added.headers.get("etag")).toBe(`"${projectRevision(await readFile(projectPath))}"`);
    expect((await added.json()).fonts).toEqual([
      { family: "Inter", weight: 700, source: "uploaded", path: "assets/fonts/inter-700.ttf" },
    ]);
    expect(await readFile(join(dir, "assets/fonts/inter-700.ttf"))).toEqual(validTtf);

    const listed = await handleFontGet(projectPath);
    expect((await listed.json()).fonts).toHaveLength(1);

    const removed = await handleFontDelete(projectPath, new Request("http://localhost/api/fonts", {
      method: "DELETE",
      body: JSON.stringify({ family: "Inter", weight: 700 }),
    }));
    expect(removed.status).toBe(200);
    expect(removed.headers.get("etag")).toBe(`"${projectRevision(await readFile(projectPath))}"`);
    expect((await removed.json()).fonts).toEqual([]);
  });

  it("materializes a Google font server-side at add-time", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/inter.ttf); }"))
      .mockResolvedValueOnce(new Response(new Uint8Array(validTtf)));
    const response = await handleFontPost(projectPath, new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "google", family: "Inter", weight: 400 }),
    }), { fetch });

    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readFile(join(dir, "assets/fonts/inter-400.ttf"))).toEqual(validTtf);
  });

  it("rejects invalid upload bytes without publishing and rejects duplicate identities", async () => {
    const invalid = new FormData();
    invalid.set("family", "Inter");
    invalid.set("weight", "400");
    invalid.set("file", new Blob(["<!doctype html>"]), "Inter.ttf");
    expect((await handleFontPost(projectPath, new Request("http://localhost/api/fonts", { method: "POST", body: invalid }))).status)
      .toBe(400);
    await expect(readFile(join(dir, "assets/fonts/inter-400.ttf"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await JSON.parse(await readFile(projectPath, "utf8"))).fonts).toEqual([]);

    expect((await handleFontPost(projectPath, uploadRequest("Inter", "400"))).status).toBe(201);
    expect((await handleFontPost(projectPath, uploadRequest("Inter", "400"))).status).toBe(409);
  });

  it("maps typed validation and Google materialization errors to explicit 4xx responses", async () => {
    const invalidSource = await handleFontPost(projectPath, new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "system", family: "Inter", weight: 400 }),
    }));
    expect(invalidSource.status).toBe(400);

    const invalidJson = await handleFontPost(projectPath, new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    expect(invalidJson.status).toBe(400);

    for (const request of [
      new Request("http://localhost/api/fonts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
      new Request("http://localhost/api/fonts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
    ]) {
      const nullBody = request.method === "POST"
        ? await handleFontPost(projectPath, request)
        : await handleFontDelete(projectPath, request);
      expect(nullBody.status).toBe(400);
      expect((await nullBody.json()).error).toMatch(/JSON object/i);
    }

    const noFontUrl = await handleFontPost(projectPath, new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "google", family: "Inter", weight: 400 }),
    }), { fetch: vi.fn().mockResolvedValue(new Response("body {}")) });
    expect(noFontUrl.status).toBe(422);

    const invalidFontBytes = await handleFontPost(projectPath, new Request("http://localhost/api/fonts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "google", family: "Inter", weight: 400 }),
    }), { fetch: vi.fn()
      .mockResolvedValueOnce(new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/inter.ttf); }"))
      .mockResolvedValueOnce(new Response("not-a-font")) });
    expect(invalidFontBytes.status).toBe(422);
  });

  it("returns HTTP 409 with the usage count and preserves an in-use font", async () => {
    const text = {
      id: "top",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      content: "Top",
      fontFamily: "Inter",
      size: 24,
      weight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#ffffff",
    };
    const inUseProject = {
      ...validProject,
      fonts: [{
        family: "Inter", weight: 400, source: "uploaded", path: "assets/fonts/inter-400.ttf",
      }],
      layouts: [{
        ...validProject.layouts[0]!,
        screens: [{
          ...validProject.layouts[0]!.screens[0]!,
          elements: [text, {
            id: "group",
            type: "group",
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
            children: [{ ...text, id: "nested" }],
          }],
        }],
      }],
    };
    await writeFile(projectPath, JSON.stringify(inUseProject));

    const response = await handleFontDelete(projectPath, new Request("http://localhost/api/fonts", {
      method: "DELETE",
      body: JSON.stringify({ family: "Inter", weight: 400 }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Font "Inter" 400 is used by 2 text elements and cannot be removed',
    });
    expect((await JSON.parse(await readFile(projectPath, "utf8"))).fonts).toHaveLength(1);
  });

  it("routes every method through the cookie-selected project session", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    process.env.PROJECT_PATH = join(dir, "configured-missing.json");
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;
    const upload = uploadRequest();

    const added = await POST(new Request(upload.url, {
      method: "POST",
      headers: { ...Object.fromEntries(upload.headers), cookie },
      body: await upload.arrayBuffer(),
    }));
    expect(added.status).toBe(201);

    const listed = await GET(sessionRequest(session.descriptor.sessionId));
    expect((await listed.json()).fonts).toHaveLength(1);

    const removed = await DELETE(sessionRequest(
      session.descriptor.sessionId,
      "DELETE",
      JSON.stringify({ family: "Inter", weight: 700 }),
    ));
    expect(removed.status).toBe(200);
    expect((await removed.json()).fonts).toEqual([]);
  });

  it("returns 409 without a session before changing fonts or the project revision", async () => {
    delete process.env.PROJECT_PATH;
    process.env.INIT_CWD = dir;
    const before = await readFile(projectPath);

    expect((await GET(new Request("http://localhost/api/fonts"))).status).toBe(409);
    expect((await POST(uploadRequest())).status).toBe(409);
    expect((await DELETE(new Request("http://localhost/api/fonts", {
      method: "DELETE",
      body: JSON.stringify({ family: "Inter", weight: 700 }),
    }))).status).toBe(409);

    const after = await readFile(projectPath);
    expect(projectRevision(after)).toBe(projectRevision(before));
    await expect(readFile(join(dir, "assets/fonts/inter-700.ttf"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
