// SPDX-License-Identifier: Apache-2.0
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAUNCH_PORT,
  openInAppWindow,
  openInBrowser,
  openProjectInHost,
  probeLaunchPort,
  resolveLaunchProject,
  runLaunchCommand,
  type LaunchDependencies,
  type PortState,
} from "./launch-command.js";
import { resolveServerPort, type RunningServer } from "./server.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

const servers: Array<{ close: (callback: () => void) => void }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "launch-project-"));
  tempDirs.push(dir);
  return dir;
}

async function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
}

function httpServer(contentType: string, body: string): Server {
  return createHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  });
}

describe("probeLaunchPort", () => {
  it("recognizes a running Screenshot Studio host", async () => {
    const port = await listen(httpServer("application/json", JSON.stringify({ app: "screenshot-studio" })));
    await expect(probeLaunchPort(port)).resolves.toBe("studio");
  });

  it("treats any other HTTP answer as another program", async () => {
    const port = await listen(httpServer("text/html", "<!doctype html><title>Other</title>"));
    await expect(probeLaunchPort(port)).resolves.toBe("other");
  });

  it("treats a listener that never answers as another program instead of waiting", async () => {
    const sockets: Socket[] = [];
    const port = await listen(createTcpServer((socket) => { sockets.push(socket); }));
    await expect(probeLaunchPort(port)).resolves.toBe("other");
    for (const socket of sockets) socket.destroy();
  });

  it("reports a port with no listener as free", async () => {
    await expect(probeLaunchPort(await resolveServerPort())).resolves.toBe("free");
  });
});

describe("openInBrowser", () => {
  it.each([
    ["darwin", "open", ["http://localhost:4747"]],
    ["win32", "cmd", ["/c", "start", "", "http://localhost:4747"]],
    ["linux", "xdg-open", ["http://localhost:4747"]],
  ] as const)("uses the %s opener without waiting for it", (platform, command, args) => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(child as never);
    const log = vi.fn();

    openInBrowser("http://localhost:4747", log, platform);

    expect(spawn).toHaveBeenCalledWith(command, args, { detached: true, stdio: "ignore" });
    expect(child.unref).toHaveBeenCalledTimes(1);
    child.emit("error", new Error("spawn ENOENT"));
    expect(log).toHaveBeenCalledWith("Open http://localhost:4747 in your browser.");
  });
});

describe("openInAppWindow", () => {
  const url = "http://localhost:4747/editor/recent_1";

  // Each spawned child emits one event once the caller has attached its listeners.
  function spawnEmitting(...events: Array<[string, ...unknown[]]>) {
    const children: Array<{ unref: ReturnType<typeof vi.fn> }> = [];
    for (const [event, ...args] of events) {
      vi.mocked(spawn).mockImplementationOnce(() => {
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        children.push(child);
        queueMicrotask(() => child.emit(event, ...args));
        return child as never;
      });
    }
    return children;
  }

  beforeEach(() => vi.mocked(spawn).mockReset());

  it("tries the next macOS browser when open cannot find one", async () => {
    const children = spawnEmitting(["exit", 1], ["exit", 0]);
    const warn = vi.fn();
    await openInAppWindow(url, vi.fn(), warn, "darwin");

    expect(spawn).toHaveBeenNthCalledWith(1, "open", ["-na", "Google Chrome", "--args", `--app=${url}`], { detached: true, stdio: "ignore" });
    expect(spawn).toHaveBeenNthCalledWith(2, "open", ["-na", "Microsoft Edge", "--args", `--app=${url}`], { detached: true, stdio: "ignore" });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    // Nothing else may keep a reopening CLI alive, so an unref'd opener would exit before its code.
    for (const child of children) expect(child.unref).not.toHaveBeenCalled();
  });

  it("starts Edge through start on Windows", async () => {
    spawnEmitting(["exit", 0]);
    await openInAppWindow(url, vi.fn(), vi.fn(), "win32");
    expect(spawn).toHaveBeenCalledWith("cmd", ["/c", "start", "", "msedge", `--app=${url}`], { detached: true, stdio: "ignore" });
  });

  it("starts the first Linux browser on PATH without waiting for it to exit", async () => {
    const children = spawnEmitting(["error", new Error("spawn ENOENT")], ["spawn"]);
    const warn = vi.fn();
    await openInAppWindow(url, vi.fn(), warn, "linux");

    expect(spawn).toHaveBeenNthCalledWith(2, "chromium", [`--app=${url}`], { detached: true, stdio: "ignore" });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(children[1]?.unref).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to a browser tab with a warning when no Chromium-based browser is found", async () => {
    spawnEmitting(["exit", 1], ["exit", 1], ["exit", 1], ["exit", 1], ["spawn"]);
    const warn = vi.fn();
    await openInAppWindow(url, vi.fn(), warn, "darwin");

    expect(warn).toHaveBeenCalledWith(
      "--app found no supported browser (Google Chrome, Microsoft Edge, Chromium, Brave Browser), so the editor opens in a browser tab instead.",
    );
    expect(spawn).toHaveBeenLastCalledWith("open", [url], { detached: true, stdio: "ignore" });
  });
});

describe("resolveLaunchProject", () => {
  function resolveDeps(cwd: string, overrides: Partial<LaunchDependencies> = {}) {
    return {
      cwd,
      env: {},
      interactive: false,
      confirm: vi.fn(async () => true),
      createProject: vi.fn(async (folder: string) => {
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "app-store-screenshots.json"), "{}");
      }),
      log: vi.fn(),
      ...overrides,
    };
  }

  it("finds the project in the folder, in its screenshot-studio subfolder, or takes a project file directly", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "other.json"), "{}");
    await mkdir(join(dir, "repo", "screenshot-studio"), { recursive: true });
    await writeFile(join(dir, "repo", "screenshot-studio", "app-store-screenshots.json"), "{}");
    await writeFile(join(dir, "app-store-screenshots.json"), "{}");

    await expect(resolveLaunchProject(".", resolveDeps(dir))).resolves.toBe(join(dir, "app-store-screenshots.json"));
    await expect(resolveLaunchProject("./repo", resolveDeps(dir)))
      .resolves.toBe(join(dir, "repo", "screenshot-studio", "app-store-screenshots.json"));
    await expect(resolveLaunchProject("./other.json", resolveDeps(dir))).resolves.toBe(join(dir, "other.json"));
  });

  it("points at init without a terminal and names a missing path", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "empty"));
    await mkdir(join(dir, "repo"));
    await writeFile(join(dir, "repo", "README.md"), "app");

    await expect(resolveLaunchProject("./empty", resolveDeps(dir))).rejects.toThrow(
      `No app-store-screenshots.json in ${join(dir, "empty")}. Create a project with: screenshots init --dir ./empty\nthen open it with: ss-studio ./empty`,
    );
    await expect(resolveLaunchProject("./repo/", resolveDeps(dir)))
      .rejects.toThrow("screenshots init --dir ./repo/screenshot-studio\nthen open it with: ss-studio ./repo/screenshot-studio");
    await expect(resolveLaunchProject(".", resolveDeps(join(dir, "repo"))))
      .rejects.toThrow("screenshots init --dir ./screenshot-studio\n");
    await expect(resolveLaunchProject("./missing", resolveDeps(dir))).rejects.toThrow(`${join(dir, "missing")} does not exist`);
  });

  it("asks in a terminal and creates the project in an empty folder or in a subfolder of a non-empty one", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "empty"));
    await writeFile(join(dir, "empty", ".DS_Store"), "");
    await mkdir(join(dir, "repo", ".git"), { recursive: true });

    const inEmpty = resolveDeps(dir, { interactive: true });
    await expect(resolveLaunchProject("./empty", inEmpty)).resolves.toBe(join(dir, "empty", "app-store-screenshots.json"));
    expect(inEmpty.confirm).toHaveBeenCalledWith(
      `No Screenshot Studio project in ${join(dir, "empty")}. Create one in ${join(dir, "empty")}? [Y/n] `,
    );
    expect(inEmpty.createProject).toHaveBeenCalledWith(join(dir, "empty"));

    const inRepo = resolveDeps(dir, { interactive: true });
    await expect(resolveLaunchProject("./repo", inRepo))
      .resolves.toBe(join(dir, "repo", "screenshot-studio", "app-store-screenshots.json"));
    expect(inRepo.createProject).toHaveBeenCalledWith(join(dir, "repo", "screenshot-studio"));
  });

  it("creates nothing when the person declines or CI is set", async () => {
    const dir = await tempDir();
    const declined = resolveDeps(dir, { interactive: true, confirm: vi.fn(async () => false) });
    await expect(resolveLaunchProject(".", declined)).rejects.toThrow(`No project was created in ${dir}.`);
    expect(declined.createProject).not.toHaveBeenCalled();

    const ci = resolveDeps(dir, { interactive: true, env: { CI: "true" } });
    await expect(resolveLaunchProject(".", ci)).rejects.toThrow(/screenshots init --dir \./);
    expect(ci.confirm).not.toHaveBeenCalled();
    expect(ci.createProject).not.toHaveBeenCalled();
  });
});

describe("openProjectInHost", () => {
  async function hostAnswering(status: number, body: unknown) {
    const received: { headers?: IncomingHttpHeaders; body?: string } = {};
    const port = await listen(createHttpServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => {
        Object.assign(received, { headers: request.headers, body: text });
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      });
    }));
    return { baseUrl: `http://localhost:${port}`, port, received };
  }

  it("sends the path the way the host's CLI guard accepts and returns the editor URL", async () => {
    const { baseUrl, port, received } = await hostAnswering(200, { entryId: "recent_00000000000000000000000000000001" });

    await expect(openProjectInHost(baseUrl, "/work/app-store-screenshots.json"))
      .resolves.toBe(`${baseUrl}/editor/recent_00000000000000000000000000000001`);
    expect(received.headers?.origin).toBeUndefined();
    expect(received.headers?.["x-screenshot-studio-cli"]).toBe("1");
    expect(received.headers?.host).toBe(`localhost:${port}`);
    expect(JSON.parse(received.body ?? "")).toEqual({ projectPath: "/work/app-store-screenshots.json" });
  });

  it("reports why the host could not open the project", async () => {
    const { baseUrl } = await hostAnswering(422, { error: "Project file is not valid" });
    await expect(openProjectInHost(baseUrl, "/work/app-store-screenshots.json"))
      .rejects.toThrow("Screenshot Studio could not open /work/app-store-screenshots.json: Project file is not valid");
  });
});

function fakeServer(port: number): RunningServer {
  return { url: `http://localhost:${port}`, exited: new Promise(() => {}), stop: vi.fn(async () => {}) };
}

function launchDeps(state: PortState, overrides: Partial<LaunchDependencies> = {}): LaunchDependencies {
  return {
    env: {},
    cwd: "/work",
    interactive: true,
    probe: vi.fn(async () => state),
    ensureBrowsers: vi.fn(async () => {}),
    startServer: vi.fn(async (port: number | undefined) => fakeServer(port ?? 51234)),
    confirm: vi.fn(async () => false),
    createProject: vi.fn(async () => {}),
    openProject: vi.fn(async (baseUrl: string) => `${baseUrl}/editor/recent_1`),
    serve: vi.fn(async () => {}),
    open: vi.fn(),
    openApp: vi.fn(async () => {}),
    log: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  };
}

describe("runLaunchCommand", () => {
  it("starts the library host on the fixed port and opens it", async () => {
    const deps = launchDeps("free");
    await runLaunchCommand({}, deps);

    expect(deps.probe).toHaveBeenCalledWith(DEFAULT_LAUNCH_PORT);
    expect(deps.ensureBrowsers).toHaveBeenCalledTimes(1);
    expect(deps.startServer).toHaveBeenCalledWith(DEFAULT_LAUNCH_PORT);
    expect(deps.open).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}`);
    expect(deps.serve).toHaveBeenCalledTimes(1);
  });

  it("reopens a running host instead of starting a second one", async () => {
    const deps = launchDeps("studio");
    await runLaunchCommand({}, deps);

    expect(deps.startServer).not.toHaveBeenCalled();
    expect(deps.ensureBrowsers).not.toHaveBeenCalled();
    expect(deps.open).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}`);
  });

  it("falls back to a free port with a warning when another program holds the fixed port", async () => {
    const deps = launchDeps("other");
    await runLaunchCommand({}, deps);

    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining(`Port ${DEFAULT_LAUNCH_PORT} is used by another program`));
    expect(deps.startServer).toHaveBeenCalledWith(undefined);
    expect(deps.open).toHaveBeenCalledWith("http://localhost:51234");
  });

  it("fails instead of moving off an explicitly requested port", async () => {
    const deps = launchDeps("other");
    await expect(runLaunchCommand({ port: "4800" }, deps)).rejects.toThrow("Port 4800 is used by another program");
    expect(deps.probe).toHaveBeenCalledWith(4800);
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it("rejects a port outside 1-65535 before probing", async () => {
    const deps = launchDeps("free");
    await expect(runLaunchCommand({ port: "65536" }, deps)).rejects.toThrow(/--port/);
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it.each([
    ["--no-open", { "no-open": "true" }, {}],
    ["--app and --no-open", { app: "true", "no-open": "true" }, {}],
    ["CI", {}, { env: { CI: "true" } }],
    ["no terminal", { app: "true" }, { interactive: false }],
  ])("does not open a browser with %s", async (_case, flags, overrides) => {
    const deps = launchDeps("free", overrides);
    await runLaunchCommand(flags, deps);
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.openApp).not.toHaveBeenCalled();
    expect(deps.serve).toHaveBeenCalledTimes(1);
  });

  it.each(["free", "studio"] as const)("opens an app window instead of a tab with --app when the port is %s", async (state) => {
    const deps = launchDeps(state);
    await runLaunchCommand({ app: "true" }, deps);
    expect(deps.openApp).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}`);
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("refuses to run in an agent session the editor started", async () => {
    const deps = launchDeps("free", { env: { SCREENSHOT_STUDIO_AGENT: "1" } });
    await expect(runLaunchCommand({}, deps)).rejects.toThrow(/does not run in an agent session/);
    expect(deps.probe).not.toHaveBeenCalled();
  });

  describe("with a project folder", () => {
    async function projectDir(): Promise<string> {
      const dir = await tempDir();
      await writeFile(join(dir, "app-store-screenshots.json"), "{}");
      return dir;
    }

    it("opens the folder in the running host instead of starting one", async () => {
      const dir = await projectDir();
      const deps = launchDeps("studio", { cwd: dir });
      await runLaunchCommand({}, deps, ".");

      expect(deps.startServer).not.toHaveBeenCalled();
      expect(deps.openProject).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}`, join(dir, "app-store-screenshots.json"));
      expect(deps.open).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}/editor/recent_1`);
    });

    it("starts the library host and then opens the folder in it", async () => {
      const dir = await projectDir();
      const deps = launchDeps("free", { cwd: dir });
      await runLaunchCommand({}, deps, ".");

      expect(deps.startServer).toHaveBeenCalledWith(DEFAULT_LAUNCH_PORT);
      expect(deps.openProject).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}`, join(dir, "app-store-screenshots.json"));
      expect(deps.open).toHaveBeenCalledWith(`http://localhost:${DEFAULT_LAUNCH_PORT}/editor/recent_1`);
      expect(deps.serve).toHaveBeenCalledTimes(1);
    });

    it("stops the host it started when the project cannot be opened", async () => {
      const dir = await projectDir();
      const server = fakeServer(DEFAULT_LAUNCH_PORT);
      const deps = launchDeps("free", {
        cwd: dir,
        startServer: vi.fn(async () => server),
        openProject: vi.fn(async () => { throw new Error("Screenshot Studio could not open it"); }),
      });

      await expect(runLaunchCommand({}, deps, ".")).rejects.toThrow("Screenshot Studio could not open it");
      expect(server.stop).toHaveBeenCalledTimes(1);
      expect(deps.open).not.toHaveBeenCalled();
      expect(deps.serve).not.toHaveBeenCalled();
    });

    it("fails before probing when the folder has no project and none is created", async () => {
      const deps = launchDeps("free", { cwd: await tempDir() });
      await expect(runLaunchCommand({}, deps, ".")).rejects.toThrow(/No project was created/);
      expect(deps.probe).not.toHaveBeenCalled();
    });
  });
});
