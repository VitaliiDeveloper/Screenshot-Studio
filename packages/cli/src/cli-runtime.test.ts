// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { closeAll, failWhenServerExits, runWithCleanup } from "./cli-runtime.js";
import type { RunningServer } from "./server.js";

describe("CLI runtime lifecycle", () => {
  it("preserves the primary operation error before a cleanup error", async () => {
    const operationError = new Error("render failed");
    const cleanupError = new Error("cleanup failed");
    const result = runWithCleanup(
      async () => { throw operationError; },
      async () => { throw cleanupError; },
    );

    await expect(result).rejects.toMatchObject({
      message: "render failed; runtime cleanup failed",
      errors: [operationError, cleanupError],
      cause: cleanupError,
    });
  });

  it("runs every close action and reports failures in action order", async () => {
    const calls: string[] = [];
    const firstError = new Error("first cleanup failed");
    const secondError = new Error("second cleanup failed");
    const result = closeAll([
      async () => { calls.push("first"); throw firstError; },
      async () => { calls.push("second"); throw secondError; },
    ]);

    await expect(result).rejects.toMatchObject({
      message: "Multiple runtime resources failed to close",
      errors: [firstError, secondError],
    });
    expect(calls).toEqual(["first", "second"]);
  });

  it("rejects when the server exits before the operation settles", async () => {
    let reportExit!: (error: Error) => void;
    const server = {
      url: "http://localhost:3000",
      exited: new Promise<Error>((resolveExit) => { reportExit = resolveExit; }),
      stop: async () => {},
    } satisfies RunningServer;
    const operation = new Promise<never>(() => {});
    const result = failWhenServerExits(server, operation);

    reportExit(new Error("Web server exited unexpectedly with code 7"));

    const observedResult = Promise.race([
      result,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("operation stayed pending after server exit")), 10);
      }),
    ]);
    await expect(observedResult).rejects.toThrow("Web server exited unexpectedly with code 7");
  });
});
