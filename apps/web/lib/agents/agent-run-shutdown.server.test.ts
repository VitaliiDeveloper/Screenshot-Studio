// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { cancelRunsOnShutdown, type ShutdownProcess } from "./agent-run-shutdown.server.js";

// A stand-in process, so no real signal reaches the test runner.
function fakeProcess(): ShutdownProcess & EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn() }) as never;
}

describe("agent run shutdown", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("cancels every run on %s and leaves the exit to the server's own handler", (signal) => {
    const target = fakeProcess();
    const cancelAll = vi.fn();
    cancelRunsOnShutdown(cancelAll, target);
    target.on(signal, () => undefined);

    target.emit(signal, signal);

    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(target.kill).not.toHaveBeenCalled();
  });

  it("re-raises a signal no other handler takes, so the process still ends", () => {
    const target = fakeProcess();
    const cancelAll = vi.fn();
    cancelRunsOnShutdown(cancelAll, target);

    target.emit("SIGTERM", "SIGTERM");

    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(target.kill).toHaveBeenCalledWith(4242, "SIGTERM");
  });

  it("cancels every run on exit", () => {
    const target = fakeProcess();
    const cancelAll = vi.fn();
    cancelRunsOnShutdown(cancelAll, target);

    target.emit("exit", 0);

    expect(cancelAll).toHaveBeenCalledTimes(1);
  });
});
