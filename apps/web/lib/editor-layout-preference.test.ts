// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  readActiveLayoutPreference,
  writeActiveLayoutPreference,
} from "@web/lib/editor-layout-preference.js";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("active layout preference", () => {
  it("stores a versioned layout id independently for each project", () => {
    const storage = new MemoryStorage();

    writeActiveLayoutPreference("project-a", "launch", storage);
    writeActiveLayoutPreference("project-b", "feature", storage);

    expect(readActiveLayoutPreference("project-a", storage)).toBe("launch");
    expect(readActiveLayoutPreference("project-b", storage)).toBe("feature");
    expect([...storage.values.values()]).toEqual([
      JSON.stringify({ version: 1, activeLayoutId: "launch" }),
      JSON.stringify({ version: 1, activeLayoutId: "feature" }),
    ]);
  });

  it("ignores stale, malformed, and unavailable browser storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("screenshot-studio:active-layout:v1:project-a", "not-json");
    storage.setItem(
      "screenshot-studio:active-layout:v1:project-b",
      JSON.stringify({ version: 2, activeLayoutId: "old" }),
    );

    expect(readActiveLayoutPreference("project-a", storage)).toBeNull();
    expect(readActiveLayoutPreference("project-b", storage)).toBeNull();
    expect(readActiveLayoutPreference("project-c", {
      getItem: () => { throw new Error("blocked"); },
    } as unknown as Storage)).toBeNull();
    expect(() => writeActiveLayoutPreference("project-c", "layout", {
      setItem: () => { throw new Error("blocked"); },
    } as unknown as Storage)).not.toThrow();
  });
});
