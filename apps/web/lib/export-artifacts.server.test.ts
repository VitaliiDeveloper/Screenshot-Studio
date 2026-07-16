// SPDX-License-Identifier: Apache-2.0
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExportArtifactStore, type ExportArtifactStore } from "./export-artifacts.server.js";

let root: string;
let sourcePath: string;
let artifactRoot: string;
let now: number;
let store: ExportArtifactStore;

function tokenFrom(downloadUrl: string): string {
  return downloadUrl.split("/").at(-1)!;
}

async function stagedPath(): Promise<string> {
  const entries = await readdir(artifactRoot);
  const filename = entries.find((entry) => entry.endsWith(".zip"));
  if (!filename) throw new Error("No staged artifact");
  return join(artifactRoot, filename);
}

async function readArtifact(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "export-artifact-test-"));
  sourcePath = join(root, "source.zip");
  artifactRoot = join(root, "private-artifacts");
  await writeFile(sourcePath, "canonical zip bytes");
  now = Date.parse("2026-07-15T00:00:00.000Z");
  store = createExportArtifactStore({
    rootDirectory: artifactRoot,
    now: () => now,
    ttlMs: 60_000,
  });
});

afterEach(async () => {
  await store.close();
  await rm(root, { recursive: true, force: true });
});

describe("export artifact store", () => {
  it("shares the default ticket store across independently evaluated route modules", async () => {
    vi.resetModules();
    const producer = await import("./export-artifacts.server.js");
    const ticket = await producer.stageExportArtifact(sourcePath, "/project/export");

    vi.resetModules();
    const consumer = await import("./export-artifacts.server.js");
    const consumed = await consumer.consumeExportArtifact(tokenFrom(ticket.downloadUrl));

    expect(consumed.status).toBe("ready");
    if (consumed.status !== "ready") return;
    expect(await readArtifact(consumed.artifact.stream)).toEqual(Buffer.from("canonical zip bytes"));
    await consumed.artifact.cleanup;

    const key = Symbol.for("screenshot-studio.export-artifact-store");
    const globals = globalThis as typeof globalThis & Record<symbol, ExportArtifactStore | undefined>;
    await globals[key]?.close();
    delete globals[key];
  });

  it("does not publish a ticket or leak a file when close starts during staging", async () => {
    let closing: Promise<void> | undefined;
    await store.close();
    store = createExportArtifactStore({
      rootDirectory: artifactRoot,
      now: () => now,
      ttlMs: 60_000,
      randomBytes: () => {
        closing = store.close();
        return Buffer.alloc(32, 0xcd);
      },
    });

    await expect(store.stage(sourcePath, "/project/export")).rejects.toThrow(
      "Export artifact store is closed",
    );
    await expect(closing).resolves.toBeUndefined();
    await expect(readdir(artifactRoot)).resolves.toEqual([]);
  });

  it("uses 256 random bits and exposes only a one-shot URL plus public metadata", async () => {
    const random = vi.fn(() => Buffer.alloc(32, 0xab));
    await store.close();
    store = createExportArtifactStore({
      rootDirectory: artifactRoot,
      now: () => now,
      ttlMs: 60_000,
      randomBytes: random,
    });

    const ticket = await store.stage(sourcePath, "/project/export");
    const token = tokenFrom(ticket.downloadUrl);

    expect(random).toHaveBeenCalledWith(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ticket).toEqual({
      downloadUrl: `/api/export/artifacts/${token}`,
      outputDir: "/project/export",
      expiresAt: "2026-07-15T00:01:00.000Z",
    });
    expect(JSON.stringify(ticket)).not.toContain(sourcePath);
    expect(JSON.stringify(ticket)).not.toContain(artifactRoot);
    const path = await stagedPath();

    const first = await store.consume(token);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") throw new Error("Expected ready artifact");
    expect(await readArtifact(first.artifact.stream)).toEqual(Buffer.from("canonical zip bytes"));
    await first.artifact.cleanup;
    await expect(access(path)).rejects.toThrow();

    await expect(store.consume(token)).resolves.toEqual({ status: "missing" });
  });

  it("copies the canonical zip so later source changes cannot alter the download", async () => {
    const ticket = await store.stage(sourcePath, "/project/export");
    await writeFile(sourcePath, "changed after stage");

    const consumed = await store.consume(tokenFrom(ticket.downloadUrl));
    expect(consumed.status).toBe("ready");
    if (consumed.status !== "ready") throw new Error("Expected ready artifact");
    expect(await readArtifact(consumed.artifact.stream)).toEqual(Buffer.from("canonical zip bytes"));
    await consumed.artifact.cleanup;
  });

  it("expires a ticket once and removes its staged file", async () => {
    const ticket = await store.stage(sourcePath, "/project/export");
    const path = await stagedPath();
    now += 60_001;

    await expect(store.consume(tokenFrom(ticket.downloadUrl))).resolves.toEqual({ status: "expired" });
    await expect(access(path)).rejects.toThrow();
    await expect(store.consume(tokenFrom(ticket.downloadUrl))).resolves.toEqual({ status: "expired" });
  });

  it.each(["symlink", "directory", "different regular file"] as const)(
    "rejects a staged leaf replaced by a %s",
    async (replacement) => {
      const ticket = await store.stage(sourcePath, "/project/export");
      const path = await stagedPath();
      await rm(path);
      if (replacement === "symlink") await symlink(sourcePath, path);
      else if (replacement === "directory") await mkdir(path);
      else await writeFile(path, "replacement bytes");

      await expect(store.consume(tokenFrom(ticket.downloadUrl))).resolves.toEqual({ status: "invalid" });
    },
  );

  it("rejects malformed tokens without touching staged tickets", async () => {
    const ticket = await store.stage(sourcePath, "/project/export");
    await expect(store.consume("../escape")).resolves.toEqual({ status: "missing" });

    const valid = await store.consume(tokenFrom(ticket.downloadUrl));
    expect(valid.status).toBe("ready");
    if (valid.status === "ready") {
      valid.artifact.stream.destroy();
      await valid.artifact.cleanup;
    }
  });

  it("deletes the private file when the node stream errors", async () => {
    const ticket = await store.stage(sourcePath, "/project/export");
    const path = await stagedPath();
    const consumed = await store.consume(tokenFrom(ticket.downloadUrl));
    if (consumed.status !== "ready") throw new Error("Expected ready artifact");
    consumed.artifact.stream.once("error", () => undefined);

    consumed.artifact.stream.destroy(new Error("consumer failed"));

    await consumed.artifact.cleanup;
    await expect(access(path)).rejects.toThrow();
  });

  it("expires and disposes a consumed stream even when the client never reads it", async () => {
    vi.useFakeTimers();
    let consumed: Awaited<ReturnType<ExportArtifactStore["consume"]>> | undefined;
    try {
      await store.close();
      store = createExportArtifactStore({
        rootDirectory: artifactRoot,
        now: () => now,
        ttlMs: 25,
      });
      const ticket = await store.stage(sourcePath, "/project/export");
      const path = await stagedPath();
      consumed = await store.consume(tokenFrom(ticket.downloadUrl));
      if (consumed.status !== "ready") throw new Error("Expected ready artifact");

      await vi.advanceTimersByTimeAsync(26);

      expect(consumed.artifact.stream.destroyed).toBe(true);
      await expect(consumed.artifact.cleanup).resolves.toBeUndefined();
      await expect(access(path)).rejects.toThrow();
    } finally {
      if (consumed?.status === "ready" && !consumed.artifact.stream.destroyed) {
        consumed.artifact.stream.destroy();
        await consumed.artifact.cleanup;
      }
      vi.useRealTimers();
    }
  });

  it("retains failed cleanup for a later store-close retry", async () => {
    await store.close();
    const unlinkFile = vi.fn()
      .mockRejectedValueOnce(new Error("temporary unlink failure"))
      .mockImplementation((path: string) => unlink(path));
    store = createExportArtifactStore({
      rootDirectory: artifactRoot,
      now: () => now,
      ttlMs: 60_000,
      unlinkFile,
    });
    const ticket = await store.stage(sourcePath, "/project/export");
    const path = await stagedPath();
    const consumed = await store.consume(tokenFrom(ticket.downloadUrl));
    if (consumed.status !== "ready") throw new Error("Expected ready artifact");

    await readArtifact(consumed.artifact.stream);
    await expect(consumed.artifact.cleanup).rejects.toThrow("temporary unlink failure");
    await expect(access(path)).resolves.toBeUndefined();

    await store.close();
    expect(unlinkFile).toHaveBeenCalledTimes(2);
    await expect(access(path)).rejects.toThrow();
  });

  it("retries an unconsumed expiry cleanup without requiring store close", async () => {
    await store.close();
    let cleanupComplete!: () => void;
    const cleanupDone = new Promise<void>((resolve) => { cleanupComplete = resolve; });
    const unlinkFile = vi.fn()
      .mockRejectedValueOnce(new Error("first unlink failure"))
      .mockRejectedValueOnce(new Error("second unlink failure"))
      .mockImplementation(async (path: string) => {
        await unlink(path);
        cleanupComplete();
      });
    store = createExportArtifactStore({
      rootDirectory: artifactRoot,
      now: () => now,
      ttlMs: 10,
      unlinkFile,
    });
    await store.stage(sourcePath, "/project/export");
    const path = await stagedPath();

    now += 11;
    await vi.waitFor(() => expect(unlinkFile).toHaveBeenCalledTimes(3), { timeout: 500 });
    await cleanupDone;

    await expect(access(path)).rejects.toThrow();
  });

  it("retries failed consumed-stream cleanup without requiring store close", async () => {
    await store.close();
    let cleanupComplete!: () => void;
    const cleanupDone = new Promise<void>((resolve) => { cleanupComplete = resolve; });
    const unlinkFile = vi.fn()
      .mockRejectedValueOnce(new Error("temporary stream cleanup failure"))
      .mockImplementation(async (path: string) => {
        await unlink(path);
        cleanupComplete();
      });
    store = createExportArtifactStore({
      rootDirectory: artifactRoot,
      now: () => now,
      ttlMs: 10,
      unlinkFile,
    });
    const ticket = await store.stage(sourcePath, "/project/export");
    const path = await stagedPath();
    const consumed = await store.consume(tokenFrom(ticket.downloadUrl));
    if (consumed.status !== "ready") throw new Error("Expected ready artifact");

    await readArtifact(consumed.artifact.stream);
    await expect(consumed.artifact.cleanup).rejects.toThrow("temporary stream cleanup failure");
    await vi.waitFor(() => expect(unlinkFile).toHaveBeenCalledTimes(2), { timeout: 500 });
    await cleanupDone;

    await expect(access(path)).rejects.toThrow();
  });
});
