// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { abandonProjectSession, closeProjectSession } from "@web/lib/project-close.js";

describe("closeProjectSession", () => {
  it("runs close inside the write fence, then clears navigation state and returns Home", async () => {
    const events: string[] = [];
    await closeProjectSession("project-one", {
      switchProject: async (activate) => {
        events.push("fence:start");
        await activate();
        events.push("fence:reset");
      },
      requestClose: async () => { events.push("session:close"); },
      clearWorkspaceState: () => { events.push("workspace:clear"); },
      navigate: () => { events.push("home"); },
    });

    expect(events).toEqual([
      "fence:start",
      "session:close",
      "fence:reset",
      "workspace:clear",
      "home",
    ]);
  });

  it("does not clear client state or navigate when the write fence fails", async () => {
    const requestClose = vi.fn(async () => undefined);
    const clearWorkspaceState = vi.fn();
    const navigate = vi.fn();

    await expect(closeProjectSession("project-one", {
      switchProject: async () => { throw new Error("disk unavailable"); },
      requestClose,
      clearWorkspaceState,
      navigate,
    })).rejects.toThrow("disk unavailable");

    expect(requestClose).not.toHaveBeenCalled();
    expect(clearWorkspaceState).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps client state when the server rejects session close", async () => {
    const clearWorkspaceState = vi.fn();
    const navigate = vi.fn();

    await expect(closeProjectSession("project-one", {
      switchProject: async (activate) => { await activate(); },
      requestClose: async () => { throw new Error("session changed"); },
      clearWorkspaceState,
      navigate,
    })).rejects.toThrow("session changed");

    expect(clearWorkspaceState).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("abandonProjectSession", () => {
  it("cancels buffered work and closes the fenced session without retrying a failed save", async () => {
    const events: string[] = [];
    await abandonProjectSession("project-one", {
      cancelPending: () => { events.push("save:cancel"); },
      drainSaves: async (operation) => {
        events.push("fence:start");
        const result = await operation();
        events.push("fence:end");
        return result;
      },
      requestClose: async () => { events.push("session:close"); },
      discardPersistence: () => { events.push("persistence:discard"); },
      clearWorkspaceState: () => { events.push("workspace:clear"); },
      navigate: () => { events.push("home"); },
    });

    expect(events).toEqual([
      "save:cancel",
      "fence:start",
      "session:close",
      "persistence:discard",
      "fence:end",
      "workspace:clear",
      "home",
    ]);
  });

  it("preserves client state when the identity-fenced close is rejected", async () => {
    const discardPersistence = vi.fn();
    const clearWorkspaceState = vi.fn();
    const navigate = vi.fn();

    await expect(abandonProjectSession("project-one", {
      cancelPending: vi.fn(),
      drainSaves: async (operation) => operation(),
      requestClose: async () => { throw new Error("session changed"); },
      discardPersistence,
      clearWorkspaceState,
      navigate,
    })).rejects.toThrow("session changed");

    expect(discardPersistence).not.toHaveBeenCalled();
    expect(clearWorkspaceState).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
