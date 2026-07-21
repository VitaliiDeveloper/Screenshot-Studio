// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FontAsset } from "@screenshot-studio/core/model";
import {
  ProjectFontRegistrationError,
  registerFont,
  registerProjectFonts,
} from "./index.js";

const registerFontWithResolver = registerFont as unknown as (
  asset: FontAsset,
  resolve: (path: string) => string,
) => Promise<void>;

const registerProjectFontsWithResolver = registerProjectFonts as unknown as (
  fonts: FontAsset[],
  resolve: (path: string) => string,
) => Promise<void>;

class TestFontFace {
  constructor(
    readonly family: string,
    readonly source: ArrayBuffer,
    readonly descriptors: FontFaceDescriptors,
  ) {}

  async load() {
    return this;
  }
}

describe("registerFont", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
    })));
    vi.stubGlobal("FontFace", TestFontFace);
    vi.stubGlobal("document", {
      fonts: {
        add: vi.fn(),
        ready: Promise.resolve(),
        load: vi.fn(),
      },
    });
  });

  it("loads font bytes through the injected resolver", async () => {
    const asset: FontAsset = {
      family: "Pacifico",
      source: "uploaded",
      path: "assets/fonts/Pacifico-Regular.ttf",
      weight: 400,
    };

    await registerFontWithResolver(asset, (path) => `/api/asset?path=${encodeURIComponent(path)}`);

    expect(fetch).toHaveBeenCalledWith("/api/asset?path=assets%2Ffonts%2FPacifico-Regular.ttf");
    expect(document.fonts.add).toHaveBeenCalledWith(expect.any(TestFontFace));
  });

  it("rejects missing font responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    })));
    const asset: FontAsset = {
      family: "Pacifico",
      source: "uploaded",
      path: "assets/fonts/missing.ttf",
      weight: 400,
    };

    await expect(
      registerFontWithResolver(asset, (path) => `/api/asset?path=${encodeURIComponent(path)}`),
    ).rejects.toThrow('Failed to load font "Pacifico" from assets/fonts/missing.ttf: HTTP 404');
  });
});

describe("registerProjectFonts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
    })));
    vi.stubGlobal("FontFace", TestFontFace);
    vi.stubGlobal("document", {
      fonts: {
        add: vi.fn(),
        ready: Promise.resolve(),
        load: vi.fn(),
      },
    });
  });

  it("waits for document fonts after registering project fonts", async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    const load = vi.fn();
    vi.stubGlobal("document", {
      fonts: {
        add: vi.fn(),
        ready,
        load,
      },
    });
    const asset: FontAsset = {
      family: "Inter",
      source: "google",
      path: "assets/fonts/inter-400.ttf",
      weight: 400,
    };

    const registration = registerProjectFontsWithResolver(
      [asset],
      (path) => `/api/asset?path=${encodeURIComponent(path)}`,
    );
    const stateBeforeReady = await Promise.race([
      registration.then(() => "settled" as const),
      Promise.resolve("waiting" as const),
    ]);
    releaseReady();
    await registration;

    expect(stateBeforeReady).toBe("waiting");
    expect(fetch).toHaveBeenCalledWith("/api/asset?path=assets%2Ffonts%2Finter-400.ttf");
    expect(document.fonts.add).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('400 16px "Screenshot Studio Sans"');
  });

  it("attempts every font and reports all failed identities together", async () => {
    const fonts: FontAsset[] = [{
      family: "Good",
      source: "uploaded",
      path: "assets/fonts/good.ttf",
      weight: 400,
    }, {
      family: "Missing",
      source: "uploaded",
      path: "assets/fonts/missing.ttf",
      weight: 500,
    }, {
      family: "Broken",
      source: "google",
      path: "assets/fonts/broken.ttf",
      weight: 700,
    }];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: url.includes("good.ttf"),
      status: url.includes("missing.ttf") ? 404 : 500,
      arrayBuffer: async () => new ArrayBuffer(4),
    })));

    const caught = await registerProjectFontsWithResolver(
      fonts,
      (path) => `/api/asset?path=${encodeURIComponent(path)}`,
    ).catch((error: unknown) => error);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(document.fonts.add).toHaveBeenCalledTimes(1);
    expect(caught).toBeInstanceOf(ProjectFontRegistrationError);
    expect((caught as ProjectFontRegistrationError).failures.map(({ font, error }) => ({
      family: font.family,
      weight: font.weight,
      message: error.message,
    }))).toEqual([{
      family: "Missing",
      weight: 500,
      message: expect.stringContaining("HTTP 404"),
    }, {
      family: "Broken",
      weight: 700,
      message: expect.stringContaining("HTTP 500"),
    }]);
  });

  it("retries failed identities without registering successful faces twice", async () => {
    const registered = new Set<TestFontFace>();
    const add = vi.fn((face: TestFontFace) => { registered.add(face); });
    vi.stubGlobal("document", {
      fonts: {
        add,
        has: (face: TestFontFace) => registered.has(face),
        ready: Promise.resolve(),
        load: vi.fn(),
      },
    });
    const fonts: FontAsset[] = [{
      family: "Good",
      source: "uploaded",
      path: "assets/fonts/good.ttf",
      weight: 400,
    }, {
      family: "Missing",
      source: "uploaded",
      path: "assets/fonts/missing.ttf",
      weight: 500,
    }];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: url.includes("good.ttf"),
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(4),
    })));

    await expect(registerProjectFontsWithResolver(fonts, (path) => path))
      .rejects.toBeInstanceOf(ProjectFontRegistrationError);
    await expect(registerProjectFontsWithResolver(fonts, (path) => path))
      .rejects.toBeInstanceOf(ProjectFontRegistrationError);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith("assets/fonts/good.ttf");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("removes managed faces that are absent from the reloaded project", async () => {
    const registered = new Set<TestFontFace>();
    const add = vi.fn((face: TestFontFace) => { registered.add(face); });
    const remove = vi.fn((face: TestFontFace) => registered.delete(face));
    vi.stubGlobal("document", {
      fonts: {
        add,
        delete: remove,
        has: (face: TestFontFace) => registered.has(face),
        ready: Promise.resolve(),
        load: vi.fn(),
      },
    });
    const first: FontAsset = {
      family: "Project Font",
      source: "uploaded",
      path: "assets/fonts/project-v1.ttf",
      weight: 400,
    };
    const replacement: FontAsset = {
      ...first,
      path: "assets/fonts/project-v2.ttf",
    };

    await registerProjectFontsWithResolver([first], (path) => path);
    const firstFace = [...registered][0]!;
    await registerProjectFontsWithResolver([replacement], (path) => path);

    expect(remove).toHaveBeenCalledWith(firstFace);
    expect(registered).toHaveLength(1);
    expect([...registered][0]!.source).not.toBe(firstFace.source);
    expect(fetch).toHaveBeenCalledTimes(2);

    const replacementFace = [...registered][0]!;
    await registerProjectFontsWithResolver([], (path) => path);

    expect(remove).toHaveBeenCalledWith(replacementFace);
    expect(registered).toHaveLength(0);
  });
});
