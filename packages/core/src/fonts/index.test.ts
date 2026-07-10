// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FontAsset } from "../model/schema.js";
import { registerFont, registerProjectFonts } from "./index.js";

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
    const ready = Promise.resolve();
    vi.stubGlobal("document", {
      fonts: {
        add: vi.fn(),
        ready,
        load: vi.fn(),
      },
    });
    const asset: FontAsset = {
      family: "Inter",
      source: "google",
      path: "assets/fonts/inter-400.ttf",
      weight: 400,
    };

    await registerProjectFontsWithResolver([asset], (path) => `/api/asset?path=${encodeURIComponent(path)}`);

    expect(fetch).toHaveBeenCalledWith("/api/asset?path=assets%2Ffonts%2Finter-400.ttf");
    expect(document.fonts.add).toHaveBeenCalledTimes(1);
  });
});
