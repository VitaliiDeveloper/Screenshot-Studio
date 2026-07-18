// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { closeProjectSession } from "./project-close.js";

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
