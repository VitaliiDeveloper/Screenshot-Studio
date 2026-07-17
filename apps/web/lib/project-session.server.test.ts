// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectSessionRegistry,
  resolveActiveProjectSession,
  type LocalFileProjectSourceAdapter,
} from "./project-session.server.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProject(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "project-session-"));
  temporaryRoots.push(root);
  const path = join(root, "app-store-screenshots.json");
  await writeFile(path, JSON.stringify({
    meta: { name, schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [],
      }],
    }],
  }));
  return path;
}

describe("ProjectSessionRegistry", () => {
  it("registers validated local projects with deterministic active-session descriptors", async () => {
    const firstPath = await createProject("First");
    const secondPath = await createProject("Second");
    const invalidRoot = await mkdtemp(join(tmpdir(), "project-session-invalid-"));
    temporaryRoots.push(invalidRoot);
    const invalidJsonPath = join(invalidRoot, "app-store-screenshots.json");
    await writeFile(invalidJsonPath, "not JSON");
    const registry = new ProjectSessionRegistry({
      createSessionId: vi.fn()
        .mockReturnValueOnce("session-a")
        .mockReturnValueOnce("session-b"),
    });

    const first = await registry.openLocal(firstPath);
    const second = await registry.openLocal(secondPath);

    expect(first).toMatchObject({
      descriptor: {
        sessionId: "session-a",
        sourceKind: "local-file",
        name: "First",
        displayLocation: await realpath(firstPath),
        capabilities: {
          writeInPlace: true,
          revealLocation: true,
          watchExternalChanges: true,
          nativePicker: false,
          projectLocalResources: true,
        },
      },
    });
    expect(second.descriptor.sessionId).toBe("session-b");
    expect(registry.get("session-a")?.projectPath).toBe(await realpath(firstPath));
    expect(registry.get("missing")).toBeUndefined();

    await expect(registry.openLocal(invalidJsonPath)).rejects.toThrow();
    expect(registry.get("session-b")?.projectPath).toBe(await realpath(secondPath));

    const cookieRequest = new Request("http://localhost/api/project", {
      headers: { cookie: "screenshot_studio_project_session=session-a" },
    });
    await expect(resolveActiveProjectSession(cookieRequest, {
      registry,
      configuredPath: () => null,
    })).resolves.toBe(first);

    await expect(resolveActiveProjectSession(new Request("http://localhost/api/project", {
      headers: { cookie: "screenshot_studio_project_session=%E0%A4%A" },
    }), {
      registry,
      configuredPath: () => null,
    })).rejects.toThrow("No active project is selected");
  });

  it("turns an opened local source into a session without reaching into core storage", async () => {
    const opened = {
      name: "Chosen",
      projectId: "project-id",
      projectPath: "/canonical/chosen.json",
      displayLocation: "/canonical/chosen.json",
      capabilities: {
        writeInPlace: true,
        revealLocation: true,
        watchExternalChanges: true,
        nativePicker: false,
        projectLocalResources: true,
      },
    };
    const localSource = {
      kind: "local-file",
      open: vi.fn().mockResolvedValue(opened),
    } satisfies Pick<LocalFileProjectSourceAdapter, "kind" | "open">;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "session-chosen",
      localSource,
    });

    await expect(registry.openLocal("chosen.json")).resolves.toMatchObject({
      descriptor: { sessionId: "session-chosen", name: "Chosen" },
      projectId: "project-id",
      projectPath: "/canonical/chosen.json",
    });
    expect(localSource.open).toHaveBeenCalledOnce();
    expect(localSource.open).toHaveBeenCalledWith("chosen.json");
  });
});
