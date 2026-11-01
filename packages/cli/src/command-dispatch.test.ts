// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "./command-dispatch.js";
import type { LaunchDependencies } from "./launch-command.js";

const USAGE = [
  "Usage: screenshots [./project-folder] [--port <port>] [--no-open]",
  "       screenshots <init|export|check|screen|dev|import|font|theme|locale|asset|layout|setup|template|element|copy|publishing|upload> [flags]",
  "ss-studio is another name for screenshots.",
].join("\n");
const UNKNOWN_COMMAND_MESSAGE = `Unknown command: wat. To open a folder, write ./wat\n${USAGE}`;

const tempDirs: string[] = [];

function launchDeps(cwd = "/work"): LaunchDependencies {
  return {
    env: {},
    cwd,
    interactive: false,
    probe: vi.fn(async () => "studio" as const),
    ensureBrowsers: vi.fn(async () => {}),
    startServer: vi.fn(),
    confirm: vi.fn(async () => false),
    createProject: vi.fn(async () => {}),
    openProject: vi.fn(async (baseUrl: string) => `${baseUrl}/editor/recent_1`),
    serve: vi.fn(async () => {}),
    open: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
}

describe("command dispatch", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("rejects unknown commands without owning terminal output or process exit", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    await expect(dispatchCommand("wat", [], { storeSpecsPath: "/store-specs.json" }))
      .rejects.toThrow(UNKNOWN_COMMAND_MESSAGE);
    expect(consoleError).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("launches the editor when no command is given", async () => {
    const launch = launchDeps();
    await dispatchCommand(undefined, [], { storeSpecsPath: "/store-specs.json", launch });
    expect(launch.probe).toHaveBeenCalledWith(4747);
  });

  it("reads launcher flags given in place of a command", async () => {
    const launch = launchDeps();
    await dispatchCommand("--port", ["4800"], { storeSpecsPath: "/store-specs.json", launch });
    expect(launch.probe).toHaveBeenCalledWith(4800);
  });

  it.each([
    [["--port", "4800", "wat"], "Unknown command: wat. To open a folder, write ./wat"],
    [["--help"], "Unknown option --help"],
    [[".", "./other"], "Open one project folder at a time, not ./other"],
  ])("rejects %j with the usage instead of launching", async ([command, ...argv], message) => {
    const launch = launchDeps();
    await expect(dispatchCommand(command, argv, { storeSpecsPath: "/store-specs.json", launch }))
      .rejects.toThrow(`${message}\n${USAGE}`);
    expect(launch.probe).not.toHaveBeenCalled();
  });

  it.each([
    [["."], 4747],
    [["--no-open", "."], 4747],
    [["--port", "4800", "."], 4800],
  ])("opens the project in the folder given as %j", async (argv, port) => {
    const dir = await mkdtemp(join(tmpdir(), "launch-dispatch-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "app-store-screenshots.json"), "{}");
    const launch = launchDeps(dir);
    const [command, ...rest] = argv;

    await dispatchCommand(command, rest, { storeSpecsPath: "/store-specs.json", launch });

    expect(launch.probe).toHaveBeenCalledWith(port);
    expect(launch.openProject).toHaveBeenCalledWith(`http://localhost:${port}`, join(dir, "app-store-screenshots.json"));
  });
});
