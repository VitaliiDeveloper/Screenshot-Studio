// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";

describe("resolveStoreSpecsPath", () => {
  it("uses the invocation root when the package runner preserves INIT_CWD", () => {
    const pathExists = vi.fn((path: string) => path === "/workspace/store-specs.json");

    expect(resolveStoreSpecsPath({
      environment: { INIT_CWD: "/workspace" },
      currentDirectory: "/workspace/apps/web",
      pathExists,
    })).toBe("/workspace/store-specs.json");
  });

  it("walks out of apps/web when a filtered runner discards INIT_CWD", () => {
    const pathExists = vi.fn((path: string) => path === "/workspace/store-specs.json");

    expect(resolveStoreSpecsPath({
      environment: {},
      currentDirectory: "/workspace/apps/web",
      pathExists,
    })).toBe("/workspace/store-specs.json");
    expect(pathExists).toHaveBeenCalledWith("/workspace/store-specs.json");
  });

  it("anchors a missing default to the workspace instead of apps/web", () => {
    const pathExists = vi.fn((path: string) => path === "/workspace/pnpm-workspace.yaml");

    expect(resolveStoreSpecsPath({
      environment: {},
      currentDirectory: "/workspace/apps/web",
      pathExists,
    })).toBe("/workspace/store-specs.json");
  });

  it("keeps an explicit override authoritative", () => {
    const pathExists = vi.fn(() => false);

    expect(resolveStoreSpecsPath({
      environment: {
        INIT_CWD: "/workspace",
        STORE_SPECS_PATH: "config/custom-store-specs.json",
      },
      currentDirectory: "/workspace/apps/web",
      pathExists,
    })).toBe("/workspace/config/custom-store-specs.json");
    expect(pathExists).not.toHaveBeenCalled();
  });
});
