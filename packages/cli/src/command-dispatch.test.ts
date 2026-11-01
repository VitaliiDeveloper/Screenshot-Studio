// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "./command-dispatch.js";
import type { LaunchDependencies } from "./launch-command.js";

const USAGE = [
  "Usage: screenshots [--port <port>] [--no-open]",
  "       screenshots <init|export|check|screen|dev|import|font|theme|locale|asset|layout|setup|template|element|copy|publishing|upload> [flags]",
].join("\n");
const UNKNOWN_COMMAND_MESSAGE = `Unknown command: wat\n${USAGE}`;

function launchDeps(): LaunchDependencies {
  return {
    env: {},
    interactive: false,
    probe: vi.fn(async () => "studio" as const),
    ensureBrowsers: vi.fn(async () => {}),
    startServer: vi.fn(),
    serve: vi.fn(async () => {}),
    open: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
}

describe("command dispatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    [["--port", "4800", "wat"], "Unknown command: wat"],
    [["--help"], "Unknown option --help"],
  ])("rejects %j with the usage instead of launching", async ([command, ...argv], message) => {
    const launch = launchDeps();
    await expect(dispatchCommand(command, argv, { storeSpecsPath: "/store-specs.json", launch }))
      .rejects.toThrow(`${message}\n${USAGE}`);
    expect(launch.probe).not.toHaveBeenCalled();
  });
});
