// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { parseProject } from "@screenshot-studio/core/model";
import { editorStore } from "@web/lib/editor/editor-store";
import { saveStatusParts, savedTimeLabel, selectionStatus, StatusBar } from "./StatusBar";

const sample = JSON.parse(readFileSync(
  new URL("../../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
  "utf8",
));
const savedAt = Date.UTC(2026, 9, 22, 14, 2, 30);
const size = "iPhone Dynamic Island · Medium";

describe("save status", () => {
  it("names every state and keeps the last save visible through a failure", () => {
    expect(saveStatusParts("idle", null)).toEqual({ text: "No unsaved changes", savedAt: null, tone: "idle" });
    expect(saveStatusParts("saving", savedAt)).toEqual({ text: "Saving…", savedAt: null, tone: "busy" });
    expect(saveStatusParts("saved", savedAt)).toEqual({ text: "Saved ·", savedAt, tone: "idle" });
    expect(saveStatusParts("error", savedAt)).toEqual({ text: "Save failed · last saved", savedAt, tone: "error" });
    expect(saveStatusParts("error", null)).toEqual({
      text: "Save failed · nothing saved yet",
      savedAt: null,
      tone: "error",
    });
  });
});

describe("StatusBar", () => {
  beforeEach(() => {
    editorStore.getState().load(parseProject(sample));
    // Server rendering reads zustand's initial state; serve the loaded project instead.
    vi.spyOn(editorStore, "getInitialState").mockImplementation(() => editorStore.getState());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    editorStore.getState().resetProjectState();
  });

  const render = () => renderToStaticMarkup(createElement(StatusBar, { specs: DEFAULT_STORE_SPECS }));

  it("is 34 px tall and lists the key hints", () => {
    const markup = render();

    expect(markup).toContain("h-[34px]");
    for (const keys of ["[ ]", "O", "⌘K", "⌘Z"]) expect(markup).toContain(`>${keys}</kbd>`);
    expect(markup).toContain("Focus/Overview");
  });

  it("shows saving and saved with the time, without announcing every autosave", () => {
    editorStore.getState().setSaveState("saving");
    expect(render()).toContain("Saving…");

    editorStore.setState({ saveStatus: "saved", lastSavedAt: savedAt });
    const markup = render();
    expect(markup).not.toContain("role=");
    expect(markup).not.toContain("aria-live");
    expect(markup).toContain(`<time dateTime="2026-10-22T14:02:30.000Z">${savedTimeLabel(savedAt)}</time>`);
    expect(markup).not.toContain('role="alert"');
  });

  it("shows the failure and the last successful save", () => {
    editorStore.setState({ saveStatus: "error", saveError: "disk unavailable", lastSavedAt: savedAt });
    const markup = render();

    expect(markup).toContain("Save failed · last saved");
    expect(markup).toContain(`>${savedTimeLabel(savedAt)}</time>`);
    expect(markup).not.toContain("disk unavailable");
    expect(markup).not.toContain("role=");
  });

  it("shows the active screen and the current selection", () => {
    expect(render()).toContain(`Hero · No layer selected · ${size}`);

    editorStore.getState().select("headline");
    expect(render()).toContain(`Hero · Hero headline · ${size}`);
  });
});

describe("selection status", () => {
  const specs = DEFAULT_STORE_SPECS;
  const state = (selected: Array<[string, string]>) => ({
    project: parseProject(sample),
    activeLayoutId: "default",
    activeScreenId: "hero",
    selectedItems: selected.map(([screenId, elementId]) => ({ screenId, elementId })),
  });

  it("describes none, one, and several layers", () => {
    expect(selectionStatus(state([]), specs)).toBe(`Hero · No layer selected · ${size}`);
    expect(selectionStatus(state([["hero", "headline"]]), specs)).toBe(`Hero · Hero headline · ${size}`);
    expect(selectionStatus(state([["hero", "headline"], ["hero", "hero-support"], ["hero", "hero-orbit-left"]]), specs))
      .toBe(`Hero · 3 layers (2 text · 1 shape) · ${size}`);
  });

  it("labels an unnamed layer by its type", () => {
    expect(selectionStatus(state([["hero", "hero-orbit-left"]]), specs)).toBe(`Hero · Shape · ${size}`);
  });

  it("names the size of the active screen, not of the first one", () => {
    const ipad = parseProject(sample).layouts[0]!.screens.find((screen) => screen.device === "ipad")!;
    const status = selectionStatus({ ...state([]), activeScreenId: ipad.id }, specs);

    expect(status).toMatch(/^Hero · No layer selected · iPad /);
  });

  it("is empty without an active screen", () => {
    expect(selectionStatus({ ...state([]), activeScreenId: null }, specs)).toBe("");
  });
});
