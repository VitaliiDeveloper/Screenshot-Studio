// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceNavigationState,
  navigateToProjectHome,
  readWorkspaceNavigationState,
  writeWorkspaceNavigationState,
  type WorkspaceNavigationState,
} from "./editor-workspace-navigation.js";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const state: WorkspaceNavigationState = {
  zoom: 0.75,
  view: "focus",
  tool: "hand",
  pattern: "grid",
  panel: "resources",
  lastPanel: "resources",
  inspectorOpen: false,
};

describe("workspace navigation state", () => {
  it("round-trips only valid versioned state and isolates projects", () => {
    const storage = new MemoryStorage();
    writeWorkspaceNavigationState("project-a", state, storage);

    expect(readWorkspaceNavigationState("project-a", storage)).toEqual(state);
    expect(readWorkspaceNavigationState("project-b", storage)).toBeNull();

    storage.setItem("screenshot-studio:workspace-navigation:v1:project-b", JSON.stringify({
      version: 1,
      ...state,
      zoom: 99,
    }));
    expect(readWorkspaceNavigationState("project-b", storage)).toBeNull();
  });

  it("clears only the selected project's workspace state", () => {
    const storage = new MemoryStorage();
    writeWorkspaceNavigationState("project-a", state, storage);
    writeWorkspaceNavigationState("project-b", { ...state, view: "overview" }, storage);

    clearWorkspaceNavigationState("project-a", storage);

    expect(readWorkspaceNavigationState("project-a", storage)).toBeNull();
    expect(readWorkspaceNavigationState("project-b", storage)?.view).toBe("overview");
  });
});

describe("navigateToProjectHome", () => {
  it("drains the pending edit and latest snapshot before navigation", async () => {
    const events: string[] = [];
    await navigateToProjectHome({
      flushPending: vi.fn(async () => { events.push("flush"); }),
      saveLatest: vi.fn(async () => { events.push("save-latest"); }),
      navigate: vi.fn(() => { events.push("navigate"); }),
    });
    expect(events).toEqual(["flush", "save-latest", "navigate"]);
  });

  it("does not navigate when the final save fails", async () => {
    const navigate = vi.fn();
    await expect(navigateToProjectHome({
      flushPending: vi.fn(async () => undefined),
      saveLatest: vi.fn(async () => { throw new Error("disk unavailable"); }),
      navigate,
    })).rejects.toThrow("disk unavailable");
    expect(navigate).not.toHaveBeenCalled();
  });
});
