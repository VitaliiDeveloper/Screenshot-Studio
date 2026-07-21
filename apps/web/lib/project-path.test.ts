// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfiguredProjectPath, resolveProjectPath } from "@web/lib/project-path.js";

const saved = { PROJECT_PATH: process.env.PROJECT_PATH, INIT_CWD: process.env.INIT_CWD };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveProjectPath", () => {
  it("returns null when PROJECT_PATH is not explicitly configured", () => {
    process.env.INIT_CWD = "/repo-root";
    delete process.env.PROJECT_PATH;
    expect(resolveConfiguredProjectPath()).toBeNull();
    expect(resolveProjectPath()).toBe("/repo-root/fixtures/sample/app-store-screenshots.json");
  });

  it("resolves a relative PROJECT_PATH against INIT_CWD, not cwd", () => {
    // `next dev` runs with cwd = apps/web; the user invokes pnpm from the repo root.
    process.env.INIT_CWD = "/repo-root";
    process.env.PROJECT_PATH = "./my-app/app-store-screenshots.json";
    expect(resolveProjectPath()).toBe("/repo-root/my-app/app-store-screenshots.json");
  });

  it("keeps an absolute PROJECT_PATH as-is", () => {
    process.env.INIT_CWD = "/repo-root";
    process.env.PROJECT_PATH = "/elsewhere/project.json";
    expect(resolveProjectPath()).toBe("/elsewhere/project.json");
  });

  it("defaults to the bundled sample relative to INIT_CWD", () => {
    process.env.INIT_CWD = "/repo-root";
    delete process.env.PROJECT_PATH;
    expect(resolveProjectPath()).toBe(
      "/repo-root/fixtures/sample/app-store-screenshots.json",
    );
  });
});
