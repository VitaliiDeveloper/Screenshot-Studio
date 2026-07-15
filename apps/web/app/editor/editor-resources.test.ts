// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { ProjectFontRegistrationError } from "@screenshot-studio/core/fonts";
import type { FontAsset, Project } from "@screenshot-studio/core/model";
import {
  loadEditorResources,
  loadProjectFontWarnings,
  missingImageUrls,
  runEditorResourceReload,
  selectEditorResourceSerializer,
  type EditorResourceSerializer,
} from "./editor-resources";

const project = {
  meta: { name: "Resources", schemaVersion: 1 },
  mode: "isolated",
  platforms: ["apple"],
  locales: ["en"],
  fonts: [],
  screens: [{
    id: "screen",
    name: "Screen",
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 100, height: 200 },
    background: { type: "image", assetUrl: "assets/background.png", fit: "cover", color: "#ffffff" },
    elements: [{
      id: "image",
      type: "image",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      assetUrl: "assets/image.png",
      fit: "contain",
      cornerRadius: 0,
    }],
  }],
} as Project;

const specs = {
  apple: {
    iphone: [{
      id: "lead",
      label: "Lead",
      width: 100,
      height: 200,
      orientation: "portrait" as const,
    }],
  },
};

const brokenFont: FontAsset = {
  family: "Broken",
  weight: 400,
  source: "uploaded",
  path: "assets/fonts/broken.ttf",
};

function successfulDependencies(events: string[] = []) {
  return {
    fetchProject: vi.fn(async () => {
      events.push("project");
      return Response.json(project, { headers: { etag: '"revision-1"' } });
    }),
    loadImages: vi.fn(async () => {
      events.push("images");
      return new Map([["assets/image.png", {} as HTMLImageElement]]);
    }),
    registerFonts: vi.fn(async () => { events.push("fonts"); }),
    fetchStoreSpecs: vi.fn(async () => {
      events.push("specs");
      return Response.json(specs);
    }),
  };
}

describe("editor resources", () => {
  it("returns only project image URLs absent from the current cache", () => {
    const cache = new Map([["assets/background.png", {} as HTMLImageElement]]);
    expect(missingImageUrls(project, cache)).toEqual(["assets/image.png"]);
  });

  it("loads and validates required resources without mutating global revision state", async () => {
    const events: string[] = [];
    const dependencies = successfulDependencies(events);

    const result = await loadEditorResources(dependencies);

    expect(result).toMatchObject({ project, revision: '"revision-1"', specs, fontWarnings: [] });
    expect(result.images.has("assets/image.png")).toBe(true);
    expect(events).toEqual(["project", "images", "fonts", "specs"]);
  });

  it.each([
    ["missing", null],
    ["weak", 'W/"revision-1"'],
    ["malformed", "revision-1"],
  ])("rejects a %s project ETag before loading resources", async (_label, etag) => {
    const dependencies = successfulDependencies();
    dependencies.fetchProject.mockResolvedValue(Response.json(project, {
      headers: etag === null ? undefined : { etag },
    }));

    await expect(loadEditorResources(dependencies)).rejects.toThrow(/strong ETag/);
    expect(dependencies.loadImages).not.toHaveBeenCalled();
  });

  it("rejects a non-2xx or invalid project before loading dependent resources", async () => {
    const nonSuccess = successfulDependencies();
    nonSuccess.fetchProject.mockResolvedValue(Response.json({ error: "no project" }, { status: 503 }));
    await expect(loadEditorResources(nonSuccess)).rejects.toThrow(/no project/);
    expect(nonSuccess.loadImages).not.toHaveBeenCalled();

    const invalid = successfulDependencies();
    invalid.fetchProject.mockResolvedValue(Response.json({ nope: true }, { headers: { etag: '"revision-1"' } }));
    await expect(loadEditorResources(invalid)).rejects.toThrow();
    expect(invalid.loadImages).not.toHaveBeenCalled();
  });

  it("keeps ordered font registration failures as recoverable warnings", async () => {
    const dependencies = successfulDependencies();
    const secondFont = { ...brokenFont, family: "Also Broken", path: "assets/fonts/also-broken.ttf" };
    const failures = [
      { font: brokenFont, error: new Error("bad bytes") },
      { font: secondFont, error: new Error("missing file") },
    ];
    dependencies.registerFonts.mockRejectedValue(new ProjectFontRegistrationError(failures));

    const result = await loadEditorResources(dependencies);

    expect(result.fontWarnings).toEqual(failures);
    expect(dependencies.fetchStoreSpecs).toHaveBeenCalledOnce();
  });

  it("treats non-font failures and every required image/spec failure as fatal", async () => {
    const imageFailure = successfulDependencies();
    imageFailure.loadImages.mockRejectedValue(new Error("image failed"));
    await expect(loadEditorResources(imageFailure)).rejects.toThrow("image failed");
    expect(imageFailure.fetchStoreSpecs).not.toHaveBeenCalled();

    const fontFailure = successfulDependencies();
    fontFailure.registerFonts.mockRejectedValue(new Error("unexpected font runtime failure"));
    await expect(loadEditorResources(fontFailure)).rejects.toThrow("unexpected font runtime failure");
    expect(fontFailure.fetchStoreSpecs).not.toHaveBeenCalled();

    const specsFailure = successfulDependencies();
    specsFailure.fetchStoreSpecs.mockResolvedValue(Response.json({ error: "specs unavailable" }, { status: 503 }));
    await expect(loadEditorResources(specsFailure)).rejects.toThrow("specs unavailable");

    const invalidSpecs = successfulDependencies();
    invalidSpecs.fetchStoreSpecs.mockResolvedValue(Response.json({ apple: { iphone: "not-an-array" } }));
    await expect(loadEditorResources(invalidSpecs)).rejects.toThrow();
  });

  it("returns only recoverable project-font failures for a font-only retry", async () => {
    const failures = [{ font: brokenFont, error: new Error("still missing") }];
    const registerFonts = vi.fn()
      .mockRejectedValueOnce(new ProjectFontRegistrationError(failures))
      .mockResolvedValueOnce(undefined);

    await expect(loadProjectFontWarnings([brokenFont], registerFonts)).resolves.toEqual(failures);
    await expect(loadProjectFontWarnings([brokenFont], registerFonts)).resolves.toEqual([]);
  });

  it("flushes through the supplied serializer and ignores a delayed stale resource response", async () => {
    const events: string[] = [];
    let releaseSave!: () => void;
    let releaseFetch!: () => void;
    let current = true;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    const apply = vi.fn();
    const serialize: EditorResourceSerializer = async <T>(operation: () => Promise<T>) => {
      events.push("save:start");
      await saveGate;
      events.push("save:end");
      return operation();
    };
    const load = vi.fn(async () => {
      events.push("load:start");
      await fetchGate;
      events.push("load:end");
      return { project, revision: '"revision-2"', images: new Map(), specs, fontWarnings: [] };
    });

    const reload = runEditorResourceReload({ serialize, load, apply, isCurrent: () => current });
    await vi.waitFor(() => expect(events).toEqual(["save:start"]));
    releaseSave();
    await vi.waitFor(() => expect(events).toEqual(["save:start", "save:end", "load:start"]));
    current = false;
    releaseFetch();

    await expect(reload).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("serializes remount reloads whenever modular editor state already has a project", () => {
    const direct: EditorResourceSerializer = (operation) => operation();
    const flushed: EditorResourceSerializer = (operation) => operation();

    expect(selectEditorResourceSerializer(false, { direct, flushed })).toBe(direct);
    expect(selectEditorResourceSerializer(true, { direct, flushed })).toBe(flushed);
  });
});
