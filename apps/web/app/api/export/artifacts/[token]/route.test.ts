// SPDX-License-Identifier: Apache-2.0
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExportArtifactStore, type ExportArtifactStore } from "@web/lib/export-artifacts.server.js";
import { handleExportArtifactGet } from "@web/app/api/export/artifacts/[token]/handler.js";
import { GET } from "@web/app/api/export/artifacts/[token]/route.js";

let root: string;
let artifactRoot: string;
let sourcePath: string;
let store: ExportArtifactStore;

function tokenFrom(downloadUrl: string): string {
  return downloadUrl.split("/").at(-1)!;
}

async function artifactPath(): Promise<string> {
  const [filename] = await readdir(artifactRoot);
  if (!filename) throw new Error("No staged artifact");
  return join(artifactRoot, filename);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifact-route-test-"));
  artifactRoot = join(root, "artifacts");
  sourcePath = join(root, "source.zip");
  await writeFile(sourcePath, "streamed zip bytes");
  store = createExportArtifactStore({ rootDirectory: artifactRoot, ttlMs: 60_000 });
});

afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});

describe("GET /api/export/artifacts/[token]", () => {
  it.each([
    ["missing", 404],
    ["expired", 410],
    ["invalid", 404],
  ] as const)("maps a %s lookup without exposing internals", async (status, expectedHttpStatus) => {
    const response = await handleExportArtifactGet("a".repeat(43), {
      consumeArtifact: vi.fn(async () => ({ status })),
    });

    expect(response.status).toBe(expectedHttpStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: status === "expired"
      ? "Export artifact expired"
      : "Export artifact not found" });
  });

  it("streams exact bytes with attachment metadata and consumes the ticket once", async () => {
    const ticket = await store.stage(sourcePath);
    const token = tokenFrom(ticket.downloadUrl);
    const path = await artifactPath();

    const response = await handleExportArtifactGet(token, {
      consumeArtifact: (candidate) => store.consume(candidate),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="app-store-screenshots-bundle.zip"',
    );
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength("streamed zip bytes")));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("streamed zip bytes"));
    await vi.waitFor(async () => { await expect(access(path)).rejects.toThrow(); });
    await expect(store.consume(token)).resolves.toEqual({ status: "missing" });
  });

  it("deletes the private artifact when the web stream is cancelled", async () => {
    const ticket = await store.stage(sourcePath);
    const path = await artifactPath();
    const response = await handleExportArtifactGet(tokenFrom(ticket.downloadUrl), {
      consumeArtifact: (candidate) => store.consume(candidate),
    });

    await response.body!.cancel();

    await vi.waitFor(async () => { await expect(access(path)).rejects.toThrow(); });
  });

  it("observes asynchronous cleanup failures after returning the streaming response", async () => {
    const cleanup = Promise.resolve();
    const catchCleanup = vi.spyOn(cleanup, "catch");
    const response = await handleExportArtifactGet("a".repeat(43), {
      consumeArtifact: vi.fn(async () => ({
        status: "ready" as const,
        artifact: {
          stream: Readable.from([Buffer.from("zip")]),
          size: 3n,
          filename: "bundle.zip",
          cleanup,
          dispose: vi.fn(async () => undefined),
        },
      })),
    });

    expect(response.status).toBe(200);
    expect(catchCleanup).toHaveBeenCalledOnce();
    await response.arrayBuffer();
  });

  it("resolves the Next dynamic params before dispatch", async () => {
    const response = await GET(
      new Request("http://localhost/api/export/artifacts/token"),
      { params: Promise.resolve({ token: "a".repeat(43) }) },
    );

    expect(response.status).toBe(404);
  });
});
