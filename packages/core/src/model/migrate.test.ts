// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { migrateToCurrent, parseProject, ProjectValidationError, SCHEMA_VERSION } from "./index.js";

function v1Project(): Record<string, unknown> {
  return {
    meta: { name: "Legacy", schemaVersion: 1 },
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "one",
      name: "One",
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: [],
    }],
  };
}

describe("migrateToCurrent", () => {
  it("migrates v1 to v2 isolated without mutating the input", () => {
    const raw = v1Project();
    const before = structuredClone(raw);
    const migrated = migrateToCurrent(raw) as Record<string, unknown>;

    expect(raw).toEqual(before);
    expect(migrated).not.toBe(raw);
    expect(migrated.mode).toBe("isolated");
    expect((migrated.meta as Record<string, unknown>).schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.screens).toEqual(before.screens);
  });

  it("returns current input unchanged", () => {
    const current = migrateToCurrent(v1Project()) as Record<string, unknown>;
    expect(migrateToCurrent(current)).toBe(current);
  });

  it("migrates a valid v3 document through v4 to current without changing screens", () => {
    const current = migrateToCurrent(v1Project()) as Record<string, unknown>;
    const v3: Record<string, unknown> = {
      ...current,
      meta: { ...(current.meta as Record<string, unknown>), schemaVersion: 3 },
    };
    const migrated = migrateToCurrent(v3) as Record<string, unknown>;
    expect((migrated.meta as Record<string, unknown>).schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.screens).toEqual(v3.screens);
  });

  it("migrates a valid v4 document to v5 without changing screens", () => {
    const current = migrateToCurrent(v1Project()) as Record<string, unknown>;
    const v4: Record<string, unknown> = {
      ...current,
      meta: { ...(current.meta as Record<string, unknown>), schemaVersion: 4 },
    };
    const migrated = migrateToCurrent(v4) as Record<string, unknown>;
    expect((migrated.meta as Record<string, unknown>).schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.screens).toEqual(v4.screens);
  });

  it("migrates a valid v5 document to v6 without changing screens", () => {
    const current = migrateToCurrent(v1Project()) as Record<string, unknown>;
    const v5: Record<string, unknown> = {
      ...current,
      meta: { ...(current.meta as Record<string, unknown>), schemaVersion: 5 },
    };
    const migrated = migrateToCurrent(v5) as Record<string, unknown>;
    expect((migrated.meta as Record<string, unknown>).schemaVersion).toBe(6);
    expect(migrated.screens).toEqual(v5.screens);
  });

  it("does not reinterpret a mode field that was invalid under strict v1", () => {
    const raw = { ...v1Project(), mode: "connected" };
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("leaves malformed and future-version input for strict validation", () => {
    expect(migrateToCurrent(null)).toBeNull();
    expect(() => parseProject({ ...v1Project(), meta: { name: "Future", schemaVersion: 99 } }))
      .toThrow(ProjectValidationError);
  });
});
