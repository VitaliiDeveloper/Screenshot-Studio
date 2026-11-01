// SPDX-License-Identifier: Apache-2.0
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAUNCH_PORT,
  openInBrowser,
  probeLaunchPort,
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

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

function fakeServer(port: number): RunningServer {
  return { url: `http://localhost:${port}`, exited: new Promise(() => {}), stop: async () => {} };
}

function launchDeps(state: PortState, overrides: Partial<LaunchDependencies> = {}): LaunchDependencies {
  return {
    env: {},
    interactive: true,
    probe: vi.fn(async () => state),
    ensureBrowsers: vi.fn(async () => {}),
    startServer: vi.fn(async (port: number | undefined) => fakeServer(port ?? 51234)),
    serve: vi.fn(async () => {}),
    open: vi.fn(),
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

  it.each([
    ["--no-open", { "no-open": "true" }, {}],
    ["CI", {}, { env: { CI: "true" } }],
    ["no terminal", {}, { interactive: false }],
  ])("does not open a browser with %s", async (_case, flags, overrides) => {
    const deps = launchDeps("free", overrides);
    await runLaunchCommand(flags, deps);
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.serve).toHaveBeenCalledTimes(1);
  });

  it("refuses to run in an agent session the editor started", async () => {
    const deps = launchDeps("free", { env: { SCREENSHOT_STUDIO_AGENT: "1" } });
    await expect(runLaunchCommand({}, deps)).rejects.toThrow(/does not run in an agent session/);
    expect(deps.probe).not.toHaveBeenCalled();
  });
});
