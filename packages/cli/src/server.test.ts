// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
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
  packagedDataRoot,
  preparePackagedRenderHost,
} from "./packaged-render-host.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  stderr = new PassThrough();

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.emit("exit", code, signal);
  }

  endStderr(chunk?: string): void {
    this.stderr.end(chunk);
  }

  finishExit(code: number | null, signal: NodeJS.Signals | null, stderr?: string): void {
    this.emitExit(code, signal);
    this.endStderr(stderr);
  }
  kill = vi.fn(() => {
    this.killed = true;
    this.finishExit(0, null);
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
    const extracted = join(host.cwd, "..", "..");
    expect(host.env.SCREENSHOT_STUDIO_DATA_ROOT).toBeDefined();
    expect(host.env.SCREENSHOT_STUDIO_DATA_ROOT!.startsWith(extracted)).toBe(false);
    expect(materialize).toHaveBeenCalledTimes(1);
    await host.cleanup();
    await rm(directory, { recursive: true, force: true });
  });
});

describe("packagedDataRoot", () => {
  it("uses the per-user data folder of each platform", () => {
    expect(packagedDataRoot({}, "darwin", "/Users/ada"))
      .toBe("/Users/ada/Library/Application Support/screenshot-studio");
    expect(packagedDataRoot({}, "linux", "/home/ada")).toBe("/home/ada/.local/share/screenshot-studio");
    expect(packagedDataRoot({ XDG_DATA_HOME: "/data" }, "linux", "/home/ada")).toBe("/data/screenshot-studio");
    expect(packagedDataRoot({ LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, "win32", "C:\\Users\\ada"))
      .toBe("C:\\Users\\ada\\AppData\\Local\\screenshot-studio");
  });

  it("resolves an explicit SCREENSHOT_STUDIO_DATA_ROOT against the launch directory", () => {
    expect(packagedDataRoot({ SCREENSHOT_STUDIO_DATA_ROOT: "studio-data" }, "darwin", "/Users/ada"))
      .toBe(join(process.cwd(), "studio-data"));
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
  it("includes only a bounded stderr tail when startup fails", async () => {
    const child = new FakeChild();
    const starting = createServerController({
      port: 4559,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => {
        child.stderr.write(`old-marker\n${"x".repeat(64 * 1024)}\nlast diagnostic line\n`);
        throw new Error("not ready");
      }),
      timeoutMs: 100,
    });

    let observed: unknown;
    try {
      await starting;
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(Error);
    const message = (observed as Error).message;
    expect(message).toContain("not ready");
    expect(message).toContain("last diagnostic line");
    expect(message).toContain("stderr tail truncated");
    expect(message).not.toContain("old-marker");
  });

  it("includes the stderr tail when a ready render host exits prematurely", async () => {
    const child = new FakeChild();
    const server = await createServerController({
      port: 4560,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    child.finishExit(9, null, "render host fatal detail\n");

    await expect(server.exited).resolves.toMatchObject({
      message: expect.stringMatching(/exited unexpectedly.*code 9[\s\S]*render host fatal detail/),
    });
  });

  it("releases the bounded stderr listener when a healthy server stops", async () => {
    const child = new FakeChild();
    const server = await createServerController({
      port: 4561,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    expect(child.stderr.listenerCount("data")).toBe(1);
    await server.stop();
    expect(child.stderr.listenerCount("data")).toBe(0);
  });

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

  it("keeps store credentials out of the render host environment", async () => {
    vi.stubEnv("APP_STORE_CONNECT_KEY_ID", "key-id");
    vi.stubEnv("APP_STORE_CONNECT_ISSUER_ID", "issuer-id");
    vi.stubEnv("app_store_connect_key_path", "/keys/AuthKey.p8");
    vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_PATH", "/keys/play.json");
    vi.stubEnv("SCREENSHOT_STUDIO_DATA_ROOT", "/data");
    const child = new FakeChild();
    const spawn = vi.fn((_cmd: string, _args: string[], _options: unknown) => child as never);
    try {
      await createServerController({
        port: 4570,
        spawn,
        waitForHttp: vi.fn(async () => undefined),
        timeoutMs: 100,
      });
    } finally {
      vi.unstubAllEnvs();
    }

    const env = (spawn.mock.calls[0]?.[2] as { env: Record<string, string> }).env;
    expect(Object.keys(env).filter((name) => /store_connect|google_play/i.test(name))).toEqual([]);
    expect(env.SCREENSHOT_STUDIO_DATA_ROOT).toBe("/data");
    expect(env.PATH).toBe(process.env.PATH);
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
    ).rejects.toThrow(/^not ready$/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("appends render-host stderr to readiness failures", async () => {
    const child = new FakeChild();
    const spawn = vi.fn((_command: string, _args: string[], _options: unknown) => child as never);

    await expect(createServerController({
      port: 4573,
      spawn,
      waitForHttp: vi.fn(async () => {
        child.stderr.write("listen EPERM 127.0.0.1:4573\n");
        throw new Error("not ready");
      }),
    })).rejects.toThrow(/not ready\nRender host stderr:\nlisten EPERM/);
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ stdio: ["ignore", "ignore", "pipe"] });
  });

  it("drains render-host stderr after readiness failure stops the child", async () => {
    const child = new FakeChild();
    child.kill = vi.fn(() => {
      child.killed = true;
      child.emitExit(0, null);
      setTimeout(() => child.endStderr("late shutdown failure\n"), 0);
      return true;
    });

    await expect(createServerController({
      port: 4575,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => {
        throw new Error("not ready");
      }),
    })).rejects.toThrow("not ready\nRender host stderr:\nlate shutdown failure");
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
    child.finishExit(7, null);
    await expect(starting).rejects.toThrow(/^Render host exited unexpectedly \(code 7\)$/);
  });

  it("reports an unexpected exit after readiness", async () => {
    const child = new FakeChild();
    const server = await createServerController({
      port: 4571,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    child.stderr.write("fatal runtime failure\n");
    child.finishExit(null, "SIGKILL");
    await expect(server.exited).resolves.toMatchObject({
      message: "Render host exited unexpectedly (signal SIGKILL)\nRender host stderr:\nfatal runtime failure",
    });
  });

  it("waits for stderr that arrives after an unexpected exit", async () => {
    const child = new FakeChild();
    const server = await createServerController({
      port: 4576,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });

    child.emitExit(1, null);
    await Promise.resolve();
    child.endStderr("late crash output\n");

    await expect(server.exited).resolves.toMatchObject({
      message: "Render host exited unexpectedly (code 1)\nRender host stderr:\nlate crash output",
    });
  });

  it("retains only the final 64 KiB of render-host stderr", async () => {
    const child = new FakeChild();
    const server = await createServerController({
      port: 4574,
      spawn: vi.fn(() => child as never),
      waitForHttp: vi.fn(async () => undefined),
      timeoutMs: 100,
    });
    const omitted = "omitted-prefix";
    const retained = "é".repeat(32 * 1024);

    child.stderr.write(`${omitted}${retained}`);
    child.finishExit(1, null);

    const failure = await server.exited;
    const diagnostic = failure.message.split("\nRender host stderr tail truncated:\n")[1];
    expect(diagnostic).toBe(retained);
    expect(Buffer.byteLength(diagnostic!)).toBe(64 * 1024);
    expect(diagnostic).not.toContain(omitted);
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
    child.finishExit(1, null);
    await stopping;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
