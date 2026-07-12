// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { closeAll, failWhenServerExits, runWithCleanup } from "./cli-runtime.js";
import type { RunningServer } from "./server.js";

describe("CLI runtime lifecycle", () => {
  it("preserves the operation error before a cleanup error", async () => {
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

  it("reports close failures in action order", async () => {
    const firstError = new Error("first cleanup failed");
    const secondError = new Error("second cleanup failed");
    const result = closeAll([
      async () => { throw firstError; },
      async () => { throw secondError; },
    ]);

    await expect(result).rejects.toMatchObject({
      message: "Multiple runtime resources failed to close",
      errors: [firstError, secondError],
    });
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

    await expect(result).rejects.toThrow("Web server exited unexpectedly with code 7");
  });
});
