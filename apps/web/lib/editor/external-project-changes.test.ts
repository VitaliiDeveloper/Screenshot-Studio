// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import { writeProjectAtomic } from "@screenshot-studio/core/storage";
import { GET, PUT } from "@web/app/api/project/route";
import {
  applyEditorResourceResult,
  loadEditorResources,
} from "@web/app/editor/editor-resources";
import { clearProjectPersistenceIdentity } from "@web/lib/clients/save-project";
import {
  cancelScheduledSave,
  saveLatestProject,
  scheduleSave,
  switchActiveProject,
  withFlushedProject,
} from "./debounced-save";
import { editorStore } from "./editor-store";
import {
  checkExternalProjectChange,
  projectChangedOnDisk,
  shouldApplyExternalReload,
} from "./external-project-changes";

const baseProject = {
  meta: { name: "Original", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: [],
    }],
  }],
};

let dir: string;
let file: string;

function projectNamed(name: string): Project {
  const project = parseProject(structuredClone(baseProject));
  project.meta.name = name;
  return project;
}

function diskName(): string {
  return JSON.parse(readFileSync(file, "utf8")).meta.name;
}

function editProjectName(name: string): void {
  const project = editorStore.getState().project!;
  editorStore.getState().replaceProject({ ...project, meta: { ...project.meta, name } });
}

/** The editor's own resource load + apply, as the Workspace runs it after a detected change. */
async function reloadEditor(): Promise<void> {
  applyEditorResourceResult(await loadEditorResources({
    loadImages: async () => new Map(),
    registerFonts: async () => undefined,
    fetchStoreSpecs: async () => Response.json(DEFAULT_STORE_SPECS),
  }));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "external-change-"));
  file = join(dir, "app-store-screenshots.json");
  writeFileSync(file, JSON.stringify(baseProject));
  process.env.PROJECT_PATH = file;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const request = new Request(new URL(input, "http://editor.test"), init);
    if (new URL(request.url).pathname !== "/api/project") throw new Error(`Unexpected fetch ${input}`);
    return request.method === "PUT" ? PUT(request) : GET(request);
  });
  await reloadEditor();
});

afterEach(() => {
  cancelScheduledSave();
  clearProjectPersistenceIdentity();
  editorStore.getState().resetProjectState();
  vi.unstubAllGlobals();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("external project changes", () => {
  it("shows an external agent's write in the open editor without a restart", async () => {
    expect(await checkExternalProjectChange()).toBe("unchanged");

    await writeProjectAtomic(file, projectNamed("Agent rename"));
    const seen = editorStore.getState().project;

    expect(await checkExternalProjectChange()).toBe("changed");
    const resources = await loadEditorResources({
      loadImages: async () => new Map(),
      registerFonts: async () => undefined,
      fetchStoreSpecs: async () => Response.json(DEFAULT_STORE_SPECS),
    });
    expect(shouldApplyExternalReload(seen, resources.revision)).toBe(true);
    applyEditorResourceResult(resources);

    expect(editorStore.getState().project?.meta.name).toBe("Agent rename");
    expect(await checkExternalProjectChange()).toBe("unchanged");
  });

  it("does not mistake the editor's own save for an external change", async () => {
    editProjectName("Editor rename");
    await saveLatestProject();

    expect(diskName()).toBe("Editor rename");
    expect(await checkExternalProjectChange()).toBe("unchanged");
  });

  it("never lets an editor save overwrite an external change", async () => {
    await writeProjectAtomic(file, projectNamed("Agent rename"));
    editProjectName("Stale editor rename");

    await expect(saveLatestProject()).rejects.toThrow(/changed on disk/);

    expect(diskName()).toBe("Agent rename");
    expect(editorStore.getState().saveStatus).toBe("error");
    expect(await checkExternalProjectChange()).toBe("conflict");
    expect(editorStore.getState().project?.meta.name).toBe("Stale editor rename");

    // "Load latest version" swaps in the disk project; later edits build on the agent's change.
    await reloadEditor();
    expect(editorStore.getState().project?.meta.name).toBe("Agent rename");
    const project = editorStore.getState().project!;
    editorStore.getState().replaceProject({
      ...project,
      meta: { ...project.meta, name: `${project.meta.name} + editor` },
    });
    await saveLatestProject();
    expect(diskName()).toBe("Agent rename + editor");
  });

  it("runs resource operations and project switches without re-saving an unchanged copy", async () => {
    await writeProjectAtomic(file, projectNamed("Agent rename"));

    await expect(withFlushedProject(async () => "exported")).resolves.toBe("exported");
    expect(editorStore.getState().saveStatus).toBe("idle");
    await expect(switchActiveProject(async () => "opened")).resolves.toBe("opened");
    expect(diskName()).toBe("Agent rename");
  });

  it("leaves a buffered edit alone so it saves or conflicts instead of being dropped", async () => {
    await writeProjectAtomic(file, projectNamed("Agent rename"));
    editProjectName("Typing");
    scheduleSave(editorStore.getState().project!);

    expect(await checkExternalProjectChange()).toBe("unchanged");
    expect(editorStore.getState().project?.meta.name).toBe("Typing");

    await expect(scheduleSave.flush()).rejects.toThrow(/changed on disk/);
    expect(diskName()).toBe("Agent rename");
    expect(await checkExternalProjectChange()).toBe("conflict");
  });

  it("skips applying a reload once the editor project changed or already matches disk", async () => {
    await writeProjectAtomic(file, projectNamed("Agent rename"));
    const seen = editorStore.getState().project;
    const resources = await loadEditorResources({
      loadImages: async () => new Map(),
      registerFonts: async () => undefined,
      fetchStoreSpecs: async () => Response.json(DEFAULT_STORE_SPECS),
    });

    editProjectName("Edited while loading");
    expect(shouldApplyExternalReload(seen, resources.revision)).toBe(false);
    expect(shouldApplyExternalReload(editorStore.getState().project, resources.revision)).toBe(true);

    applyEditorResourceResult(resources);
    expect(shouldApplyExternalReload(editorStore.getState().project, resources.revision)).toBe(false);
  });

  it("ignores a half-written project and another project's response", async () => {
    writeFileSync(file, "{\"meta\":");
    expect(await checkExternalProjectChange()).toBe("unchanged");

    await writeProjectAtomic(file, projectNamed("Agent rename"));
    const otherProject = async () => new Response(null, {
      status: 200,
      headers: { etag: "\"other\"", "x-project-id": "other-project" },
    });
    expect(await projectChangedOnDisk(otherProject)).toBe(false);
    expect(await projectChangedOnDisk()).toBe(true);
  });
});
