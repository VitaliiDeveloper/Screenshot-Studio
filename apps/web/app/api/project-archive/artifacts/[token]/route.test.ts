// SPDX-License-Identifier: Apache-2.0
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectArchiveArtifactStore, type ProjectArchiveArtifactStore } from "@web/lib/project-archive-artifacts.server.js";
import { handleProjectArchiveArtifactGet } from "./handler.js";
import { GET } from "./route.js";

let root: string;
let sourcePath: string;
let store: ProjectArchiveArtifactStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "project-archive-artifact-route-"));
  sourcePath = join(root, "source.zip");
  await writeFile(sourcePath, "project archive bytes");
  store = createProjectArchiveArtifactStore({ rootDirectory: join(root, "artifacts"), ttlMs: 60_000 });
});

afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});

describe("GET /api/project-archive/artifacts/[token]", () => {
  it("streams the distinct archive filename and consumes the ticket once", async () => {
    const ticket = await store.stage(sourcePath);
    const token = ticket.downloadUrl.split("/").at(-1)!;
    const response = await handleProjectArchiveArtifactGet(token, {
      consumeArtifact: (candidate) => store.consume(candidate),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition"))
      .toBe('attachment; filename="screenshot-studio-project.zip"');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("project archive bytes");
    await expect(store.consume(token)).resolves.toEqual({ status: "missing" });
  });

  it.each([["missing", 404], ["expired", 410], ["invalid", 404]] as const)(
    "maps %s tickets without exposing storage",
    async (status, httpStatus) => {
      const response = await handleProjectArchiveArtifactGet("a".repeat(43), {
        consumeArtifact: vi.fn(async () => ({ status })),
      });
      expect(response.status).toBe(httpStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("deletes its private artifact after stream cancellation", async () => {
    const ticket = await store.stage(sourcePath);
    const token = ticket.downloadUrl.split("/").at(-1)!;
    const [stagedPath] = await readdir(join(root, "artifacts"));
    const response = await handleProjectArchiveArtifactGet(token, {
      consumeArtifact: (candidate) => store.consume(candidate),
    });
    await response.body!.cancel();
    await vi.waitFor(async () => {
      await expect(access(join(root, "artifacts", stagedPath!))).rejects.toThrow();
    });
  });

  it("resolves dynamic route params", async () => {
    const response = await GET(new Request("http://localhost/api/project-archive/artifacts/token"), {
      params: Promise.resolve({ token: "a".repeat(43) }),
    });
    expect(response.status).toBe(404);
  });
});
