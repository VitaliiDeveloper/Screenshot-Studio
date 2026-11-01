// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  createSystemFontScanner,
  readFontkitMetadata,
  type SystemFontScanner,
} from "@screenshot-studio/cli/system-fonts";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import {
  handleSystemFontImport,
  handleSystemFontPreview,
  handleSystemFontsGet,
} from "./handler.js";

const shared = vi.hoisted(() => ({
  scanner: undefined as SystemFontScanner | undefined,
  failure: undefined as Error | undefined,
}));
vi.mock("@web/lib/system-fonts.server.js", () => ({
  sharedSystemFontScanner: () => {
    if (shared.failure) throw shared.failure;
    return shared.scanner;
  },
}));

import { GET as listRoute } from "./route.js";
import { GET as previewRoute } from "./preview/route.js";
import { POST as importRoute } from "./import/route.js";

const pacifico = new URL("../../../../../fixtures/sample/assets/fonts/Pacifico-Regular.ttf", import.meta.url);
const arabic = new URL("../../../../../fixtures/regressions/rtl-parity/assets/fonts/noto-sans-arabic-700.ttf", import.meta.url);

const emptyProject = {
  meta: { name: "System fonts", schemaVersion: 1 },
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
let fontDir: string;
let projectPath: string;
let scanner: SystemFontScanner;
let pacificoBytes: Buffer;
const originalInitCwd = process.env.INIT_CWD;

beforeAll(async () => {
  pacificoBytes = await readFile(pacifico);
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "system-font-route-"));
  fontDir = join(dir, "installed");
  await mkdir(fontDir, { recursive: true });
  await copyFile(pacifico, join(fontDir, "Pacifico-Regular.ttf"));
  await copyFile(arabic, join(fontDir, "Locked-Arabic.ttf"));
  projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, JSON.stringify(emptyProject));
  scanner = createSystemFontScanner({
    roots: [{ dir: fontDir, source: "system" }],
    readMetadata: (bytes, fileName) => readFontkitMetadata(bytes, fileName).map((face) => (
      fileName.startsWith("Locked") ? { ...face, restrictedEmbedding: true } : face
    )),
  });
  shared.scanner = scanner;
  shared.failure = undefined;
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  if (originalInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = originalInitCwd;
  await rm(dir, { recursive: true, force: true });
});

async function idOf(family: string): Promise<string> {
  const face = (await scanner.list()).find((candidate) => candidate.family === family);
  return face!.id;
}

function previewRequest(query: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost/api/system-fonts/preview${query}`, init);
}

function importRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("http://localhost/api/system-fonts/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

describe("system font handlers", () => {
  it("lists faces by opaque id with their policy and never exposes a path", async () => {
    const response = await handleSystemFontsGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.fonts.map((font: { family: string; weight: number; source: string; unavailable?: string }) => (
      [font.family, font.weight, font.source, font.unavailable === undefined]
    ))).toEqual([
      ["Noto Sans Arabic", 700, "system", false],
      ["Pacifico", 400, "system", true],
    ]);
    expect(body.fonts[0].unavailable).toMatch(/Restricted License embedding/);
    expect(body.fonts.map((font: { style: string }) => font.style)).toEqual(["Bold", "Regular"]);
    expect(JSON.stringify(body)).not.toContain(dir);
  });

  it("streams preview bytes for a scanner id and answers unknown ids with 404", async () => {
    const id = await idOf("Pacifico");
    const response = await handleSystemFontPreview(previewRequest(`?id=${id}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).equals(pacificoBytes)).toBe(true);

    for (const unknown of [`sf_${"0".repeat(32)}`, encodeURIComponent(join(fontDir, "Pacifico-Regular.ttf")), "..%2F..%2Fetc%2Fpasswd"]) {
      expect((await handleSystemFontPreview(previewRequest(`?id=${unknown}`))).status).toBe(404);
    }
  });

  it("does not accept a client-supplied path or any parameter other than one id", async () => {
    const id = await idOf("Pacifico");
    const outside = encodeURIComponent(join(dir, "app-store-screenshots.json"));

    for (const query of ["", `?path=${outside}`, `?id=${id}&path=${outside}`, `?id=${id}&id=${id}`, "?id="]) {
      expect((await handleSystemFontPreview(previewRequest(query))).status).toBe(400);
    }
    for (const body of [{ id, path: outside }, { path: outside }, { id: 7 }, [], null]) {
      const response = await handleSystemFontImport(projectPath, importRequest(body));
      expect(response.status).toBe(400);
    }
    expect((await handleSystemFontImport(projectPath, new Request("http://localhost/x", { method: "POST", body: "{" }))).status).toBe(400);
    expect(JSON.parse(await readFile(projectPath, "utf8")).fonts).toEqual([]);
  });

  it("refuses to serve or import a disabled font", async () => {
    const id = await idOf("Noto Sans Arabic");

    expect((await handleSystemFontPreview(previewRequest(`?id=${id}`))).status).toBe(422);
    const response = await handleSystemFontImport(projectPath, importRequest({ id }));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/Restricted License embedding/);
    expect(JSON.parse(await readFile(projectPath, "utf8")).fonts).toEqual([]);
  });

  it("imports a face as an uploaded font named from its metadata", async () => {
    const response = await handleSystemFontImport(projectPath, importRequest({ id: await idOf("Pacifico") }));

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe(`"${projectRevision(await readFile(projectPath))}"`);
    expect((await response.json()).fonts).toEqual([
      { family: "Pacifico", weight: 400, source: "uploaded", path: "assets/fonts/pacifico-400.ttf" },
    ]);
    expect((await readFile(join(dir, "assets/fonts/pacifico-400.ttf"))).equals(pacificoBytes)).toBe(true);
  });

  it("answers an unknown import id with 404 and leaves the project untouched", async () => {
    const before = await readFile(projectPath);

    const response = await handleSystemFontImport(projectPath, importRequest({ id: `sf_${"1".repeat(32)}` }));

    expect(response.status).toBe(404);
    expect(await readFile(projectPath)).toEqual(before);
  });

  it("reports a duplicate family and weight with 409 instead of overwriting", async () => {
    const id = await idOf("Pacifico");
    expect((await handleSystemFontImport(projectPath, importRequest({ id }))).status).toBe(201);
    const registered = await readFile(projectPath);

    const duplicate = await handleSystemFontImport(projectPath, importRequest({ id }));

    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already registered/);
    expect(await readFile(projectPath)).toEqual(registered);
  });

  it("reports a misconfigured scanner as a clear error instead of throwing out of the handler", async () => {
    shared.failure = new TypeError("SCREENSHOT_STUDIO_SYSTEM_FONT_ROOTS must be a JSON array of { dir, source } objects");

    for (const response of [
      await handleSystemFontsGet(),
      await handleSystemFontPreview(previewRequest("?id=x")),
      await handleSystemFontImport(projectPath, importRequest({ id: "x" })),
    ]) {
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/SCREENSHOT_STUDIO_SYSTEM_FONT_ROOTS must be a JSON array/);
    }
  });

  it("does not serve a symlink that leaves the scanned folder", async () => {
    const outside = join(dir, "outside.ttf");
    await writeFile(outside, "secret");
    await symlink(outside, join(fontDir, "Escape.ttf"));

    const faces = (await (await handleSystemFontsGet()).json()).fonts as Array<{ family: string }>;

    expect(faces.map(({ family }) => family)).not.toContain("Escape");
  });
});

describe("system font routes", () => {
  it("rejects non-loopback hosts before touching the scanner", async () => {
    const list = vi.spyOn(scanner, "list");
    const read = vi.spyOn(scanner, "read");
    const headers = { host: "rebind.example.com" };

    for (const response of [
      await listRoute(new Request("http://rebind.example.com/api/system-fonts", { headers })),
      await previewRoute(previewRequest("?id=x", { headers })),
      await importRoute(importRequest({ id: "x" }, { headers })),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(list).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("requires the active project session and identity", async () => {
    delete process.env.PROJECT_PATH;
    process.env.INIT_CWD = dir;

    expect((await listRoute(new Request("http://localhost/api/system-fonts"))).status).toBe(409);
    expect((await previewRoute(previewRequest("?id=x"))).status).toBe(409);
    expect((await importRoute(importRequest({ id: "x" }))).status).toBe(409);
  });

  it("lists, previews and imports through the cookie-selected project session", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;
    const fenced = { cookie, "x-project-id": session.projectId };
    const id = await idOf("Pacifico");

    expect((await listRoute(new Request("http://localhost/api/system-fonts", { headers: fenced }))).status).toBe(200);
    expect((await previewRoute(previewRequest(`?id=${id}`, { headers: fenced }))).status).toBe(200);
    expect((await previewRoute(previewRequest(`?id=${id}`, { headers: { cookie } }))).status).toBe(428);

    const stale = await importRoute(importRequest({ id }, {
      headers: { ...fenced, "content-type": "application/json", "if-match": '"stale-revision"' },
    }));
    expect(stale.status).toBe(412);

    const imported = await importRoute(importRequest({ id }, {
      headers: {
        ...fenced,
        "content-type": "application/json",
        "if-match": `"${projectRevision(await readFile(projectPath))}"`,
      },
    }));
    expect(imported.status).toBe(201);
    expect((await imported.json()).fonts).toHaveLength(1);
  });
});
