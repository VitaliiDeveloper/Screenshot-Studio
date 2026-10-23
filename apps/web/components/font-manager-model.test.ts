// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FontAsset, Project } from "@screenshot-studio/core/model";
import { editorStore } from "@web/lib/editor/editor-store.js";
import { appendWarning, reconcileFontMutationResponse } from "./font-manager-model.js";

const font: FontAsset = {
  family: "Inter",
  weight: 400,
  source: "uploaded",
  path: "assets/fonts/inter-400.ttf",
};

function project(fonts: FontAsset[] = []): Project {
  return {
    meta: { name: "Local", schemaVersion: 1 },
    fonts,
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
        direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#111111" },
        elements: [{
          id: "headline",
          type: "text",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          opacity: 1,
          locked: false,
          visible: true,
          content: "Headline",
          fontFamily: "system-ui",
          size: 24,
          weight: 400,
          lineHeight: 1.2,
          letterSpacing: 0,
          align: "left",
          color: "#ffffff",
        }],
      }],
    }],
  };
}

function response(body: unknown, status = 200, etag = '"server-revision"'): Response {
  return Response.json(body, { status, headers: { etag } });
}

function seedHistory(initial: Project): void {
  editorStore.getState().load(initial);
  editorStore.getState().patchElement({
    id: "headline",
    type: "text",
    patch: { x: 10 },
  });
  editorStore.getState().endHistoryGroup();
  editorStore.getState().patchElement({
    id: "headline",
    type: "text",
    patch: { y: 20 },
  });
  editorStore.getState().undo();
  expect(editorStore.getState().historyPast).not.toEqual([]);
  expect(editorStore.getState().historyFuture).not.toEqual([]);
}

describe("reconcileFontMutationResponse", () => {
  beforeEach(() => {
    editorStore.setState({
      project: null,
      activeScreenId: null,
      selectedItems: [],
      historyPast: [],
      historyFuture: [],
      historyGroupKey: null,
    });
  });

  it("accepts the complete authoritative add, updates its revision, and clears history", async () => {
    seedHistory(project());
    const previousProject = editorStore.getState().project!;
    const authoritative: Project = {
      ...structuredClone(previousProject),
      meta: { ...previousProject.meta, name: "Concurrent server name" },
      fonts: [font],
      layouts: previousProject.layouts.map((layout) => ({
        ...layout,
        screens: layout.screens.map((screen) => ({
          ...screen,
          background: { type: "solid" as const, color: "#abcdef" },
        })),
      })),
    };
    const setProjectRevision = vi.fn();
    const registerAddedFont = vi.fn().mockResolvedValue(undefined);

    const result = await reconcileFontMutationResponse({
      response: response(authoritative, 201),
      previousProject,
      operation: "add",
    }, {
      replaceProject: editorStore.getState().replaceProject,
      setProjectRevision,
      registerAddedFont,
    });

    expect(result.warning).toBeNull();
    expect(setProjectRevision).toHaveBeenCalledWith('"server-revision"');
    expect(registerAddedFont).toHaveBeenCalledWith(font);
    expect(editorStore.getState().project).toEqual(authoritative);
    expect(editorStore.getState()).toMatchObject({ historyPast: [], historyFuture: [] });
    editorStore.getState().undo();
    editorStore.getState().redo();
    expect(editorStore.getState().project).toEqual(authoritative);
  });

  it("keeps the authoritative add when browser preview registration fails", async () => {
    seedHistory(project());
    const previousProject = editorStore.getState().project!;
    const authoritative = { ...structuredClone(previousProject), fonts: [font] };

    const result = await reconcileFontMutationResponse({
      response: response(authoritative, 201),
      previousProject,
      operation: "add",
    }, {
      replaceProject: editorStore.getState().replaceProject,
      setProjectRevision: vi.fn(),
      registerAddedFont: vi.fn().mockRejectedValue(new Error("preview decode failed")),
    });

    expect(result.warning).toMatch(/saved to the project.*preview.*decode failed/i);
    expect(editorStore.getState().project).toEqual(authoritative);
    expect(editorStore.getState()).toMatchObject({ historyPast: [], historyFuture: [] });
  });

  it("replaces the complete remove result before deleting matching browser faces", async () => {
    seedHistory(project([font]));
    const previousProject = editorStore.getState().project!;
    const authoritative: Project = {
      ...structuredClone(previousProject),
      meta: { ...previousProject.meta, name: "Server remove result" },
      fonts: [],
    };
    const removeBrowserFaces = vi.fn(() => {
      expect(editorStore.getState().project).toEqual(authoritative);
    });

    await reconcileFontMutationResponse({
      response: response(authoritative),
      previousProject,
      operation: "remove",
      removedFont: font,
    }, {
      replaceProject: editorStore.getState().replaceProject,
      setProjectRevision: vi.fn(),
      removeBrowserFaces,
    });

    expect(removeBrowserFaces).toHaveBeenCalledWith(font);
    expect(editorStore.getState().project).toEqual(authoritative);
    expect(editorStore.getState()).toMatchObject({ historyPast: [], historyFuture: [] });
  });

  it("leaves project and history untouched when the server rejects an in-use font", async () => {
    seedHistory(project([font]));
    const before = editorStore.getState();
    const replaceProject = vi.fn(editorStore.getState().replaceProject);
    const setProjectRevision = vi.fn();
    const removeBrowserFaces = vi.fn();

    await expect(reconcileFontMutationResponse({
      response: response({ error: 'Font "Inter" 400 is used by 2 text elements and cannot be removed' }, 409),
      previousProject: before.project!,
      operation: "remove",
      removedFont: font,
    }, {
      replaceProject,
      setProjectRevision,
      removeBrowserFaces,
    })).rejects.toThrow(/used by 2 text elements/);

    expect(replaceProject).not.toHaveBeenCalled();
    expect(setProjectRevision).not.toHaveBeenCalled();
    expect(removeBrowserFaces).not.toHaveBeenCalled();
    expect(editorStore.getState().project).toBe(before.project);
    expect(editorStore.getState().historyPast).toEqual(before.historyPast);
    expect(editorStore.getState().historyFuture).toEqual(before.historyFuture);
  });
});

describe("appendWarning", () => {
  it("keeps earlier warnings when later adds also warn", () => {
    expect(appendWarning(null, null)).toBeNull();
    expect(appendWarning(null, "first")).toBe("first");
    expect(appendWarning("first", null)).toBe("first");
    expect(appendWarning("first", "second")).toBe("first\nsecond");
  });
});
