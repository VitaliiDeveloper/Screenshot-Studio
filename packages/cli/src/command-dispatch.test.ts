// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "./command-dispatch.js";

const UNKNOWN_COMMAND_MESSAGE =
  "Unknown command: wat\nUsage: screenshots <init|export|check|screen|dev|import|font|theme|locale|asset|layout|setup|template|element|copy|publishing|upload> [flags]";

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
});
