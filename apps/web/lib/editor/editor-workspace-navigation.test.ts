// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceNavigationState,
  navigateToProjects,
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
  panel: "add",
  lastPanel: "add",
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

    // The Resources panel became rail entries; stale state falls back to defaults.
    storage.setItem("screenshot-studio:workspace-navigation:v1:project-c", JSON.stringify({
      version: 1,
      ...state,
      panel: "resources",
    }));
    expect(readWorkspaceNavigationState("project-c", storage)).toBeNull();

    const agent = { ...state, panel: "agent", lastPanel: "agent" } satisfies WorkspaceNavigationState;
    writeWorkspaceNavigationState("project-d", agent, storage);
    expect(readWorkspaceNavigationState("project-d", storage)).toEqual(agent);
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

describe("navigateToProjects", () => {
  it("saves the project before navigation", async () => {
    const events: string[] = [];
    await navigateToProjects({
      save: vi.fn(async () => { events.push("save"); }),
      navigate: vi.fn(() => { events.push("navigate"); }),
    });
    expect(events).toEqual(["save", "navigate"]);
  });

  it("does not navigate when the final save fails", async () => {
    const navigate = vi.fn();
    await expect(navigateToProjects({
      save: vi.fn(async () => { throw new Error("disk unavailable"); }),
      navigate,
    })).rejects.toThrow("disk unavailable");
    expect(navigate).not.toHaveBeenCalled();
  });
});
