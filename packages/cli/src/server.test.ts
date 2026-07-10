// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createServerController, extractWebArchive, resolveServerPort } from "./server.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  });
}

describe("resolveServerPort", () => {
  it("uses an explicit port unchanged", async () => {
    await expect(resolveServerPort(3123)).resolves.toBe(3123);
  });
});

describe("extractWebArchive", () => {
  it("materializes the packaged standalone host tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "render-host-archive-"));
    const archivePath = join(directory, "web.zip");
    const destination = join(directory, "extracted");
    const archive = new JSZip();
    archive.file("apps/web/server.js", "server");
    await writeFile(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await extractWebArchive(archivePath, destination);
    await expect(readFile(join(destination, "apps/web/server.js"), "utf8")).resolves.toBe("server");
    await rm(directory, { recursive: true, force: true });
  });
});

describe("createServerController", () => {
  it("spawns Next on the resolved port and returns a localhost URL", async () => {
    const child = new FakeChild();
    const spawn = vi.fn((_cmd: string, _args: string[]) => child as never);
    const waitForHttp = vi.fn(async () => undefined);
    const server = await createServerController({
      port: 4567,
      spawn,
      waitForHttp,
      timeoutMs: 100,
    });

    const spawnArgs = spawn.mock.calls[0]?.[1];
    expect(spawnArgs).toContain("4567");
    expect(waitForHttp).toHaveBeenCalledWith("http://localhost:4567", 100);
    expect(server.url).toBe("http://localhost:4567");
    await server.stop();
    await server.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("passes the project path to the web app when supplied", async () => {
    const child = new FakeChild();
    const spawn = vi.fn((_cmd: string, _args: string[], _options: unknown) => child as never);
    await createServerController({
      port: 4569,
      projectPath: "/tmp/app-store-screenshots.json",
      spawn,
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    const spawnOptions = spawn.mock.calls[0]?.[2] as { env?: Record<string, string> };
    expect(spawnOptions.env?.PROJECT_PATH).toBe("/tmp/app-store-screenshots.json");
  });

  it("kills the child when readiness fails", async () => {
    const child = new FakeChild();
    await expect(
      createServerController({
        port: 4568,
        spawn: vi.fn(() => child as never),
        waitForHttp: vi.fn(async () => {
          throw new Error("not ready");
        }),
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/not ready/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("fails readiness promptly when the render host exits", async () => {
    const child = new FakeChild();
    const pendingReadiness = vi.fn(async () => new Promise<void>(() => undefined));
    const starting = createServerController({
      port: 4570,
      spawn: vi.fn(() => child as never),
      waitForHttp: pendingReadiness,
      timeoutMs: 10_000,
    });

    await vi.waitFor(() => expect(pendingReadiness).toHaveBeenCalledTimes(1));
    child.exitCode = 7;
    child.emit("exit", 7, null);
    await expect(starting).rejects.toThrow(/exited unexpectedly.*code 7/);
  });

  it("reports an unexpected exit after readiness", async () => {
    const child = new FakeChild();
    const server = await createServerController({
      port: 4571,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    child.exitCode = null;
    child.emit("exit", null, "SIGKILL");
    await expect(server.exited).resolves.toMatchObject({
      message: expect.stringMatching(/exited unexpectedly.*SIGKILL/),
    });
  });

  it("runs host cleanup when child termination fails", async () => {
    const child = new FakeChild();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("kill failed")));
      return false;
    });
    const cleanup = vi.fn(async () => undefined);
    const server = await createServerController({
      port: 4572,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      prepareHost: vi.fn(async () => ({
        command: "node",
        args: [],
        cwd: "/tmp",
        env: {},
        cleanup,
      })),
    });

    const stopping = server.stop();
    child.emit("exit", 1, null);
    await stopping;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
