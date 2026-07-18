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
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
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

class ScopedTestFontFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: FontFaceDescriptors,
  ) {}

  async load() {
    return this;
  }
}

function successfulDependencies(events: string[] = []) {
  return {
    fetchProject: vi.fn(async () => {
      events.push("project");
      return Response.json(project, {
        headers: { etag: '"revision-1"', "x-project-id": "project-1" },
      });
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

    expect(result).toMatchObject({
      project,
      projectId: "project-1",
      revision: '"revision-1"',
      specs,
      fontWarnings: [],
    });
    expect(result.images.has("assets/image.png")).toBe(true);
    expect(events).toEqual(["project", "images", "fonts", "specs"]);
    const imageResolver = (dependencies.loadImages.mock.calls[0] as unknown as [
      Project,
      (path: string) => string,
    ])[1];
    const fontResolver = (dependencies.registerFonts.mock.calls[0] as unknown as [
      Project["fonts"],
      (path: string) => string,
    ])[1];
    expect(imageResolver("assets/image.png")).toContain(
      "projectId=project-1&revision=%22revision-1%22&path=assets%2Fimage.png",
    );
    expect(fontResolver("assets/fonts/example.ttf")).toContain(
      "projectId=project-1&revision=%22revision-1%22&path=assets%2Ffonts%2Fexample.ttf",
    );
  });

  it("replaces same-metadata managed fonts when the project resource scope changes", async () => {
    const sharedFont: FontAsset = {
      family: "Shared Project Font",
      weight: 400,
      source: "uploaded",
      path: "assets/fonts/shared.ttf",
    };
    const fontProject = { ...structuredClone(project), fonts: [sharedFont] };
    const registered = new Set<ScopedTestFontFace | object>();
    const unrelatedFace = { family: sharedFont.family, weight: String(sharedFont.weight) };
    registered.add(unrelatedFace);
    const add = vi.fn((face: ScopedTestFontFace) => { registered.add(face); });
    const remove = vi.fn((face: ScopedTestFontFace) => registered.delete(face));
    const fetchFont = vi.fn(async (url: string) => new Response(
      Uint8Array.of(url.includes("project-b") ? 0x42 : 0x41),
    ));
    vi.stubGlobal("FontFace", ScopedTestFontFace);
    vi.stubGlobal("fetch", fetchFont);
    vi.stubGlobal("document", {
      fonts: {
        add,
        delete: remove,
        has: (face: ScopedTestFontFace) => registered.has(face),
        ready: Promise.resolve(),
        load: vi.fn(),
      },
    });
    const dependenciesFor = (projectId: string) => ({
      fetchProject: vi.fn(async () => Response.json(fontProject, {
        headers: { etag: '"shared-revision"', "x-project-id": projectId },
      })),
      loadImages: vi.fn(async () => new Map()),
      fetchStoreSpecs: vi.fn(async () => Response.json(specs)),
    });

    try {
      await loadEditorResources(dependenciesFor("project-a"));
      const firstFace = [...registered].find(
        (face): face is ScopedTestFontFace => face instanceof ScopedTestFontFace,
      )!;
      await loadEditorResources(dependenciesFor("project-b"));

      expect(fetchFont).toHaveBeenCalledTimes(2);
      expect(fetchFont.mock.calls.map(([url]) => url)).toEqual([
        expect.stringContaining("projectId=project-a"),
        expect.stringContaining("projectId=project-b"),
      ]);
      expect(remove).toHaveBeenCalledWith(firstFace);
      expect(remove).not.toHaveBeenCalledWith(unrelatedFace);
      const projectFaces = [...registered].filter(
        (face): face is ScopedTestFontFace => face instanceof ScopedTestFontFace,
      );
      expect(projectFaces).toHaveLength(1);
      expect(new Uint8Array(projectFaces[0]!.source)[0]).toBe(0x42);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("requires an opaque project identifier before loading dependent resources", async () => {
    const dependencies = successfulDependencies();
    dependencies.fetchProject.mockResolvedValue(Response.json(project, {
      headers: { etag: '"revision-1"' },
    }));

    await expect(loadEditorResources(dependencies)).rejects.toThrow(/project identifier/i);
    expect(dependencies.loadImages).not.toHaveBeenCalled();
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
      return {
        project,
        projectId: "project-1",
        revision: '"revision-2"',
        images: new Map(),
        specs,
        fontWarnings: [],
      };
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
