import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createServerController, resolveServerPort } from "./server.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit");
    return true;
  });
}

describe("resolveServerPort", () => {
  it("uses an explicit port unchanged", async () => {
    await expect(resolveServerPort(3123)).resolves.toBe(3123);
  });

  it("allocates a free localhost port when omitted", async () => {
    const port = await resolveServerPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });
});

describe("createServerController", () => {
  it("spawns Next on the resolved port and returns a localhost URL", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    const waitForHttp = vi.fn(async () => undefined);
    const server = await createServerController({
      port: 4567,
      spawn,
      waitForHttp,
      timeoutMs: 100,
    });

    expect(spawn.mock.calls[0]![1]).toContain("4567");
    expect(waitForHttp).toHaveBeenCalledWith("http://localhost:4567", 100);
    expect(server.url).toBe("http://localhost:4567");
    await server.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
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
});
