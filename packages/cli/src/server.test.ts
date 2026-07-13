// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  createServerController,
  extractWebArchive as extractWebArchiveFromServer,
  materializeSharpRuntime as materializeSharpRuntimeFromServer,
  prepareRenderHost as prepareRenderHostFromServer,
  resolveServerPort,
  type PreparedRenderHost as PreparedRenderHostFromServer,
} from "./server.js";
import {
  extractWebArchive,
  materializeSharpRuntime,
  preparePackagedRenderHost,
} from "./packaged-render-host.js";

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

describe("server compatibility exports", () => {
  it("retains packaged render-host helpers on the server module", () => {
    const prepared: PreparedRenderHostFromServer | undefined = undefined;
    expect(prepared).toBeUndefined();
    expect(extractWebArchiveFromServer).toBe(extractWebArchive);
    expect(materializeSharpRuntimeFromServer).toBe(materializeSharpRuntime);
    expect(prepareRenderHostFromServer).toBeTypeOf("function");
  });
});

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

  it("restores internal package directory links from the portable manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "render-host-links-"));
    const archivePath = join(directory, "web.zip");
    const destination = join(directory, "extracted");
    const archive = new JSZip();
    archive.file("node_modules/.pnpm/react/index.js", "react");
    archive.file(".screenshot-studio-links.json", JSON.stringify({
      version: 1,
      links: [{
        path: "apps/web/node_modules/react",
        target: "node_modules/.pnpm/react",
        type: "directory",
      }],
    }));
    await writeFile(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await extractWebArchive(archivePath, destination);
    await expect(readFile(join(destination, "apps/web/node_modules/react/index.js"), "utf8"))
      .resolves.toBe("react");
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects links whose target escapes the extracted host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "render-host-link-escape-"));
    const archivePath = join(directory, "web.zip");
    const archive = new JSZip();
    archive.file("apps/web/server.js", "server");
    archive.file(".screenshot-studio-links.json", JSON.stringify({
      version: 1,
      links: [{ path: "apps/web/node_modules/react", target: "../outside", type: "directory" }],
    }));
    await writeFile(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await expect(extractWebArchive(archivePath, join(directory, "extracted")))
      .rejects.toThrow(/Unsafe packaged render-host link/);
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects an archive entry whose original path escapes the extracted host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "render-host-path-escape-"));
    const archivePath = join(directory, "web.zip");
    const archive = new JSZip();
    archive.file("../outside.txt", "outside");
    await writeFile(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await expect(extractWebArchive(archivePath, join(directory, "extracted")))
      .rejects.toThrow(/Unsafe packaged render-host path/);
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects a link manifest whose original archive path escapes the extracted host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "render-host-manifest-path-escape-"));
    const archivePath = join(directory, "web.zip");
    const archive = new JSZip();
    archive.file(
      "../.screenshot-studio-links.json",
      JSON.stringify({ version: 1, links: [] }),
      { createFolders: false },
    );
    await writeFile(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await expect(extractWebArchive(archivePath, join(directory, "extracted")))
      .rejects.toThrow(/Unsafe packaged render-host path/);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("preparePackagedRenderHost", () => {
  it("validates and prepares an extracted standalone host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "render-host-preparation-"));
    const archivePath = join(directory, "web.zip");
    const archive = new JSZip();
    archive.file("apps/web/server.js", "server");
    await writeFile(archivePath, await archive.generateAsync({ type: "nodebuffer" }));
    const materialize = vi.fn(async () => [] as string[]);

    const host = await preparePackagedRenderHost(4789, archivePath, materialize);

    expect(host.command).toBe(process.execPath);
    expect(host.args[0]).toMatch(/apps\/web\/server\.js$/);
    expect(host.env).toMatchObject({ NODE_ENV: "production", PORT: "4789", HOSTNAME: "127.0.0.1" });
    expect(materialize).toHaveBeenCalledTimes(1);
    await host.cleanup();
    await rm(directory, { recursive: true, force: true });
  });
});

describe("materializeSharpRuntime", () => {
  it("finds the installed platform package even when package.json is not exported", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sharp-runtime-installed-"));
    const copied = await materializeSharpRuntime(directory);

    expect(copied).toContain("sharp");
    expect(copied).toContain("@img/colour");
    expect(copied.some((name) => /^@img\/sharp-(?!libvips)/.test(name))).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("copies required and installed optional packages into the extracted host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sharp-runtime-"));
    const packages = join(directory, "packages");
    const destination = join(directory, "host");
    const manifests = new Map<string, string>();
    for (const [name, manifest] of [
      ["sharp", { dependencies: { "sharp-required": "1" }, optionalDependencies: { "sharp-native": "1", "sharp-missing": "1" } }],
      ["sharp-required", {}],
      ["sharp-native", {}],
    ] as const) {
      const path = join(packages, name, "package.json");
      await mkdir(join(packages, name), { recursive: true });
      await writeFile(path, JSON.stringify({ name, ...manifest }));
      manifests.set(name, path);
    }

    const copied = await materializeSharpRuntime(destination, (name) => {
      const manifest = manifests.get(name);
      if (!manifest) throw new Error(`Missing ${name}`);
      return manifest;
    });

    expect(copied).toEqual(["sharp", "sharp-native", "sharp-required"]);
    await expect(readFile(join(destination, "node_modules", "sharp", "package.json"), "utf8"))
      .resolves.toContain('"name":"sharp"');
    await expect(readFile(join(destination, "node_modules", "sharp-native", "package.json"), "utf8"))
      .resolves.toContain('"name":"sharp-native"');
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

  it("passes project and store-spec paths to the web app when supplied", async () => {
    const child = new FakeChild();
    const spawn = vi.fn((_cmd: string, _args: string[], _options: unknown) => child as never);
    await createServerController({
      port: 4569,
      projectPath: "/tmp/app-store-screenshots.json",
      storeSpecsPath: "/opt/screenshot-studio/store-specs.json",
      spawn,
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    const spawnOptions = spawn.mock.calls[0]?.[2] as { env?: Record<string, string> };
    expect(spawnOptions.env?.PROJECT_PATH).toBe("/tmp/app-store-screenshots.json");
    expect(spawnOptions.env?.STORE_SPECS_PATH).toBe("/opt/screenshot-studio/store-specs.json");
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
