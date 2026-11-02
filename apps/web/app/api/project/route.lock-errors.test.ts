// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ManagedProjectLifecycleChangedError,
  withManagedProjectMutationGuard,
  withManagedProjectReadGuard,
} from "@web/lib/managed-projects/managed-project-mutation-guard.server.js";
import { StorageLockTimeoutError } from "@web/lib/storage-lock.server.js";
import { GET as getAsset } from "@web/app/api/asset/route.js";
import { GET, PUT } from "./route.js";

vi.mock("@web/lib/managed-projects/managed-project-mutation-guard.server.js", async (importOriginal) => ({
  ...await importOriginal<object>(),
  withManagedProjectMutationGuard: vi.fn(),
  withManagedProjectReadGuard: vi.fn(),
}));

const project = {
  meta: { name: "Guarded", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "primary",
  layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
    id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
  }] }],
};

let dir: string;
let previousProjectPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "project-route-lock-errors-"));
  const projectPath = join(dir, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify(project));
  previousProjectPath = process.env.PROJECT_PATH;
  process.env.PROJECT_PATH = projectPath;
});

afterEach(() => {
  vi.resetAllMocks();
  if (previousProjectPath === undefined) delete process.env.PROJECT_PATH;
  else process.env.PROJECT_PATH = previousProjectPath;
  rmSync(dir, { recursive: true, force: true });
});

const failures = [
  [new ManagedProjectLifecycleChangedError(), 409, "lifecycle-changed"],
  [new StorageLockTimeoutError("Timed out"), 423, "project-busy"],
] as const;

describe.each(failures)("%s from the managed guard", (error, status, code) => {
  beforeEach(() => {
    vi.mocked(withManagedProjectMutationGuard).mockRejectedValue(error);
    vi.mocked(withManagedProjectReadGuard).mockRejectedValue(error);
  });

  async function activeProjectId(): Promise<string> {
    vi.mocked(withManagedProjectReadGuard).mockImplementationOnce((_session, operation) => operation());
    const response = await GET(new Request("http://localhost/api/project"));
    return response.headers.get("x-project-id")!;
  }

  it(`answers ${status} JSON to GET /api/project`, async () => {
    const response = await GET(new Request("http://localhost/api/project"));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, error: expect.any(String) });
  });

  it(`answers ${status} JSON to PUT /api/project`, async () => {
    const response = await PUT(new Request("http://localhost/api/project", {
      method: "PUT",
      headers: { "if-match": "\"revision\"", "x-project-id": await activeProjectId() },
      body: JSON.stringify(project),
    }));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, error: expect.any(String) });
  });

  it(`answers ${status} JSON to GET /api/asset`, async () => {
    const query = new URLSearchParams({
      path: "assets/shot.png",
      projectId: await activeProjectId(),
      revision: "\"revision\"",
    });
    const response = await getAsset(new Request(`http://localhost/api/asset?${query}`));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code, error: expect.any(String) });
  });
});
