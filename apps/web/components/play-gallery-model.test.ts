// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { buildBundleEntries, DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import type { CanvasMode, Project, Screen } from "@screenshot-studio/core/model";
import {
  initialPlayback,
  nearestSlideIndex,
  playbackReducer,
  playEntries,
} from "./play-gallery-model.js";

function screen(id: string, overrides: Partial<Screen> = {}): Screen {
  return {
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [],
    ...overrides,
  } as Screen;
}

function project(mode: CanvasMode): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "main",
    layouts: [{
      id: "main",
      name: "Main",
      mode,
      screens: [
        screen("first"),
        screen("android", { platform: "android", device: "phone" }),
        screen("first-de", { locale: "de" }),
        screen("second"),
        screen("first-65", { variantOf: "first", storeTargetId: "6.5" }),
        screen("second-65", { variantOf: "second", storeTargetId: "6.5" }),
      ],
    }],
  } as Project;
}

const ids = (activeScreenId: string, mode: CanvasMode = "isolated") =>
  playEntries(project(mode), "main", activeScreenId, DEFAULT_STORE_SPECS).map((entry) => entry.screen.id);

describe("play gallery screen set", () => {
  it("keeps only the active destination, size, and locale in export order", () => {
    expect(ids("first")).toEqual(["first", "second"]);
    expect(ids("second-65")).toEqual(["first-65", "second-65"]);
    expect(ids("first-de")).toEqual(["first-de"]);
    expect(ids("android")).toEqual(["android"]);
  });

  it("uses the same connected group that export crops", () => {
    expect(ids("second", "connected")).toEqual(["first", "second"]);
    expect(ids("first-65", "connected")).toEqual(["first-65", "second-65"]);
  });

  it("matches the export bundle entries for that output", () => {
    const source = project("connected");
    const exported = buildBundleEntries(source, "main", DEFAULT_STORE_SPECS)
      .filter((entry) => entry.screen.platform === "apple" && entry.screen.locale === "en"
        && entry.target.id === "6.5")
      .map((entry) => entry.relativePath);
    expect(playEntries(source, "main", "first-65", DEFAULT_STORE_SPECS).map((entry) => entry.relativePath))
      .toEqual(exported);
  });

  it("falls back to the first screen and is empty when export cannot resolve the size", () => {
    expect(ids("missing")).toEqual(["first", "second"]);
    const broken = project("isolated");
    broken.layouts[0]!.screens[0]!.storeTargetId = "no-such-size";
    expect(playEntries(broken, "main", "first", DEFAULT_STORE_SPECS)).toEqual([]);
    expect(playEntries(null, null, null, DEFAULT_STORE_SPECS)).toEqual([]);
  });
});

describe("play gallery autoplay", () => {
  const reduce = playbackReducer(3);

  it("starts playing only when there is a next screen", () => {
    expect(initialPlayback(3)).toEqual({ index: 0, playing: true });
    expect(initialPlayback(1)).toEqual({ index: 0, playing: false });
  });

  it("advances on each tick and stops on the last screen", () => {
    let state = initialPlayback(3);
    state = reduce(state, { type: "tick" });
    expect(state).toEqual({ index: 1, playing: true });
    state = reduce(state, { type: "tick" });
    expect(state).toEqual({ index: 2, playing: false });
    expect(reduce(state, { type: "tick" })).toBe(state);
  });

  it("pauses on manual navigation and clamps to the set", () => {
    const state = initialPlayback(3);
    expect(reduce(state, { type: "go", index: 1 })).toEqual({ index: 1, playing: false });
    expect(reduce(state, { type: "go", index: 9 })).toEqual({ index: 2, playing: false });
    expect(reduce(state, { type: "go", index: -1 })).toEqual({ index: 0, playing: false });
    expect(reduce(state, { type: "pause" })).toEqual({ index: 0, playing: false });
  });

  it("tracks scrolled position without changing playback", () => {
    expect(reduce({ index: 0, playing: true }, { type: "scrolled", index: 2 })).toEqual({ index: 2, playing: true });
    const state = { index: 1, playing: true };
    expect(reduce(state, { type: "scrolled", index: 1 })).toBe(state);
  });

  it("toggles playback and restarts from the first screen at the end", () => {
    expect(reduce({ index: 1, playing: true }, { type: "toggle" })).toEqual({ index: 1, playing: false });
    expect(reduce({ index: 1, playing: false }, { type: "toggle" })).toEqual({ index: 1, playing: true });
    expect(reduce({ index: 2, playing: false }, { type: "toggle" })).toEqual({ index: 0, playing: true });
    expect(playbackReducer(1)({ index: 0, playing: false }, { type: "toggle" })).toEqual({ index: 0, playing: false });
  });

  it("finds the slide nearest the viewport center", () => {
    expect(nearestSlideIndex([100, 500, 900], 480)).toBe(1);
    expect(nearestSlideIndex([100, 500, 900], 2000)).toBe(2);
    expect(nearestSlideIndex([100], 0)).toBe(0);
  });
});
