// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { Project as ProjectSchema, type Project, type Screen, type ScreenSetPolicy } from "@screenshot-studio/core/model";
import { collectLayoutIssues } from "@screenshot-studio/core/validation";
import { editorStore } from "@web/lib/editor/editor-store";
import { localeMatrix, localeMatrixSummary, type MissingLocaleIssue } from "./locale-matrix-model";

const ARTBOARD = { width: 660, height: 1434 };
const VARIANT_ARTBOARD = { width: 642, height: 1389 };

function screen(id: string, name: string, locale: string, extra: Partial<Screen> = {}): Screen {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    direction: "ltr",
    artboard: ARTBOARD,
    background: { type: "solid", color: "#101827" },
    elements: [],
    ...extra,
  } as Screen;
}

function variant(id: string, name: string, locale: string, root: string): Screen {
  return screen(id, name, locale, { variantOf: root, storeTargetId: "6.5", artboard: VARIANT_ARTBOARD });
}

function load(screens: Screen[], policies?: ScreenSetPolicy[]): void {
  const project: Project = ProjectSchema.parse({
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens,
      ...(policies ? { screenSetPolicies: policies } : {}),
    }],
  });
  editorStore.getState().load(project);
}

const synced = (locale: string, device = "iphone"): ScreenSetPolicy => ({
  platform: "apple",
  device,
  locale,
  mode: "synchronized",
}) as ScreenSetPolicy;

const ipad = (id: string, name: string, locale: string) => screen(id, name, locale, { device: "ipad" });

function matrixFor(activeScreenId: string) {
  const state = editorStore.getState();
  const layout = state.project!.layouts[0]!;
  const issues = collectLayoutIssues(state.project!, layout.id);
  return {
    issues,
    matrix: localeMatrix(layout, layout.screens.find((candidate) => candidate.id === activeScreenId)!, issues),
  };
}

function summaryFor(activeScreenId: string): string {
  const { matrix } = matrixFor(activeScreenId);
  const layout = editorStore.getState().project!.layouts[0]!;
  return localeMatrixSummary(layout, matrix, layout.screens.find((candidate) => candidate.id === activeScreenId)!, DEFAULT_STORE_SPECS);
}

function missingCells(activeScreenId: string): string[] {
  const { matrix } = matrixFor(activeScreenId);
  return matrix.rows.flatMap(({ screen: row, cells }) => cells.flatMap((cell, index) =>
    cell ? [`${row.name}:${matrix.locales[index]}`] : []));
}

function create(issue: MissingLocaleIssue): void {
  editorStore.getState().createScreenFromLocale(issue.sourceScreenId, issue.locale);
}

function localeNames(locale: string): string[] {
  return editorStore.getState().project!.layouts[0]!.screens
    .filter((candidate) => candidate.locale === locale)
    .map((candidate) => `${candidate.name}${candidate.storeTargetId ? `@${candidate.storeTargetId}` : ""}`);
}

beforeEach(() => editorStore.getState().resetProjectState());

describe("locale matrix", () => {
  it("shows the first locale's screens against every locale and marks only what Issues reports", () => {
    load([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      screen("hero-de", "Hero", "de"),
    ]);

    const { matrix, issues } = matrixFor("hero");

    expect(matrix.locales).toEqual(["en", "de"]);
    expect(matrix.rows.map((row) => row.screen.name)).toEqual(["Hero", "Details"]);
    expect(missingCells("hero")).toEqual(["Details:de"]);
    expect(matrix.rows[1]!.cells[1]).toBe(issues.find((issue) => issue.kind === "missing-locale-screen"));
  });

  describe("Sync sizes", () => {
    beforeEach(() => load([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      variant("details-65", "Details", "en", "details"),
      screen("hero-de", "Hero", "de"),
      variant("hero-de-65", "Hero", "de", "hero-de"),
    ], [synced("en"), synced("de")]));

    it("reports a variant row missing together with its primary slot", () => {
      expect(matrixFor("hero-65").matrix.structure).toBe("synchronized");
      expect(missingCells("hero")).toEqual(["Details:de"]);
      expect(missingCells("hero-65")).toEqual(["Details:de"]);
    });

    it("creates the screen in every size as one undo step and clears the cell", () => {
      const cell = matrixFor("hero-65").matrix.rows[1]!.cells[1]!;

      create(cell);

      expect(localeNames("de")).toEqual(["Hero", "Details", "Hero@6.5", "Details@6.5"]);
      expect(editorStore.getState().historyPast).toHaveLength(1);
      expect(missingCells("hero")).toEqual([]);
      expect(collectLayoutIssues(editorStore.getState().project!, "default")).toEqual([]);

      editorStore.getState().undo();

      expect(localeNames("de")).toEqual(["Hero", "Hero@6.5"]);
      expect(missingCells("hero")).toEqual(["Details:de"]);
    });
  });

  describe("Separate", () => {
    beforeEach(() => load([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      variant("details-65", "Details", "en", "details"),
      screen("hero-de", "Hero", "de"),
      variant("hero-de-65", "Hero", "de", "hero-de"),
    ]));

    it("shows only the current size, so each size row stands on its own", () => {
      expect(matrixFor("hero").matrix.structure).toBe("independent");
      expect(matrixFor("hero").matrix.rows.map((row) => row.screen.id)).toEqual(["hero", "details"]);
      expect(matrixFor("hero-65").matrix.rows.map((row) => row.screen.id)).toEqual(["hero-65", "details-65"]);
      expect(missingCells("hero-65")).toEqual(["Details:de"]);
    });

    it("creates the screen in the current size only as one undo step", () => {
      create(matrixFor("hero-65").matrix.rows[1]!.cells[1]!);

      expect(localeNames("de")).toEqual(["Hero", "Hero@6.5", "Details@6.5"]);
      expect(editorStore.getState().historyPast).toHaveLength(1);
      expect(missingCells("hero-65")).toEqual([]);
      expect(missingCells("hero")).toEqual(["Details:de"]);

      editorStore.getState().undo();

      expect(localeNames("de")).toEqual(["Hero", "Hero@6.5"]);
    });
  });

  describe("issues the shown size does not own", () => {
    it("counts them apart under Separate and still names the shown size", () => {
      load([
        screen("hero", "Hero", "en"),
        ipad("pad", "Pad", "en"),
        ipad("pad-2", "Pad 2", "en"),
        screen("hero-de", "Hero", "de"),
        ipad("pad-de", "Pad", "de"),
      ]);

      expect(matrixFor("hero").matrix).toMatchObject({ missing: 0, elsewhere: 1 });
      expect(summaryFor("hero")).toMatch(/^Default · Separate · iPhone .* · 1 screen × 2 locales · 0 missing · 1 in other sizes$/);
      expect(summaryFor("pad")).toMatch(/^Default · Separate · iPad .* · 2 screens × 2 locales · 1 missing$/);
    });

    it("counts other destinations apart under Sync sizes and names the destination", () => {
      load([
        screen("hero", "Hero", "en"),
        ipad("pad", "Pad", "en"),
        ipad("pad-2", "Pad 2", "en"),
        screen("hero-de", "Hero", "de"),
        ipad("pad-de", "Pad", "de"),
      ], [synced("en"), synced("de"), synced("en", "ipad"), synced("de", "ipad")]);

      expect(matrixFor("hero").matrix).toMatchObject({ missing: 0, elsewhere: 1 });
      expect(summaryFor("hero")).toBe("Default · Sync sizes · iPhone · 1 screen × 2 locales · 0 missing · 1 in other sizes");
    });
  });

  describe("locales whose screen structure differs", () => {
    beforeEach(() => load([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      variant("details-65", "Details", "en", "details"),
      screen("hero-de", "Hero", "de"),
      variant("hero-de-65", "Hero", "de", "hero-de"),
    ], [synced("de")]));

    it("follows each issue, so a cell says what its own click will do", () => {
      const cell = matrixFor("hero-65").matrix.rows[1]!.cells[1]!;

      expect(matrixFor("hero-65").matrix.structure).toBe("independent");
      expect(cell.allSizes).toBe(true);

      create(cell);

      expect(localeNames("de")).toEqual(["Hero", "Details", "Hero@6.5", "Details@6.5"]);
      expect(missingCells("hero-65")).toEqual([]);
    });
  });
});
