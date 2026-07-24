// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { Project, type Project as ProjectModel } from "@screenshot-studio/core/model";
import {
  applyCaptureImportPlan,
  assertCaptureImportConfirmation,
  discoverCaptureImport,
  planCaptureImport,
  type CaptureImportInputFile,
} from "./index.js";

const png = new Uint8Array(await readFile(new URL(
  "../../../../fixtures/regressions/screenshot-parity/assets/shot.png",
  import.meta.url,
)));

function file(relativePath: string, bytes: Uint8Array = png): CaptureImportInputFile {
  return { relativePath, bytes };
}

function sampleProject(): ProjectModel {
  return Project.parse({
    meta: { name: "Import Project", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Feature campaign",
      mode: "isolated",
      screens: [{
        id: "apple-iphone-en-01",
        name: "Existing hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      }],
    }],
  });
}

describe("discoverCaptureImport", () => {
  it("normalizes a selected project root and reports deterministic captures, assets, and counts", () => {
    const discovery = discoverCaptureImport({
      files: [
        file("Selected/screenshots/apple/iphone/en/01.png"),
        file("Selected/screenshots/android/phone/en/02.png"),
        file("Selected/assets/icons/product.png", new Uint8Array([1, 2, 3])),
      ],
    });

    expect(discovery.captures.map(({ sourcePath }) => sourcePath)).toEqual([
      "screenshots/android/phone/en/02.png",
      "screenshots/apple/iphone/en/01.png",
    ]);
    expect(discovery.assets.map(({ sourcePath, destinationPath }) => ({
      sourcePath,
      destinationPath,
    }))).toEqual([{
      sourcePath: "assets/icons/product.png",
      destinationPath: "assets/icons/product.png",
    }]);
    expect(discovery.summary).toEqual({
      screenCount: 2,
      assetCount: 1,
      platforms: [
        { id: "App Store", count: 1 },
        { id: "Google Play", count: 1 },
      ],
      devices: [
        { id: "App Store · iPhone", count: 1 },
        { id: "Google Play · Android phone", count: 1 },
      ],
      locales: [{ id: "en", count: 2 }],
    });
    expect(discovery.warnings).toEqual([]);
    expect(discovery.invalidEntries).toEqual([]);
    expect(discovery.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the existing CLI capture-root shape and explains unsupported entries", () => {
    const discovery = discoverCaptureImport({
      files: [
        file("apple/ipad/fr/02.PNG"),
        file("android/tablet-7/en/01.png"),
        file("notes.txt", new TextEncoder().encode("notes")),
      ],
    });

    expect(discovery.captures).toHaveLength(2);
    expect(discovery.captures[0]).toMatchObject({
      sourcePath: "android/tablet-7/en/01.png",
      platform: "android",
      device: "tablet-7",
      locale: "en",
    });
    expect(discovery.captures[1]).toMatchObject({
      sourcePath: "apple/ipad/fr/02.PNG",
      platform: "apple",
      device: "ipad",
      locale: "fr",
      filename: "02.PNG",
    });
    expect(discovery.warnings).toEqual([
      {
        code: "unsupported-input",
        path: "notes.txt",
        message: "Skipping unsupported input \"notes.txt\"",
      },
    ]);
    expect(discovery.invalidEntries).toEqual([]);
  });

  it("uses catalog labels for every destination and representative device summary", () => {
    const discovery = discoverCaptureImport({
      files: [
        file("apple/iphone/en/01.png"),
        file("apple/ipad/en/01.png"),
        file("apple/watchos/en/01.png"),
        file("android/phone/en/01.png"),
        file("android/tablet-7/en/01.png"),
        file("android/wear/en/01.png"),
        file("windows/xbox/en/01.png"),
        file("web/desktop/en/01.png"),
        file("web/laptop/en/01.png"),
      ],
    });

    expect(discovery.summary.platforms).toEqual([
      { id: "App Store", count: 3 },
      { id: "Google Play", count: 3 },
      { id: "Microsoft Store", count: 1 },
      { id: "Web", count: 2 },
    ]);
    expect(discovery.summary.devices).toEqual([
      { id: "App Store · iPad", count: 1 },
      { id: "App Store · iPhone", count: 1 },
      { id: "App Store · watchOS", count: 1 },
      { id: "Google Play · Android phone", count: 1 },
      { id: "Google Play · Android tablet", count: 1 },
      { id: "Google Play · Wear OS", count: 1 },
      { id: "Microsoft Store · Xbox", count: 1 },
      { id: "Web · Desktop", count: 1 },
      { id: "Web · Laptop", count: 1 },
    ]);
    expect(discovery.summary.platforms.map(({ id }) => id)).not.toContain("apple");
    expect(discovery.summary.devices.map(({ id }) => id)).not.toContain("android/tablet-7");
  });

  it("reports unsafe, duplicate portable, hidden, malformed PNG, and bounded inputs as invalid", () => {
    const discovery = discoverCaptureImport({
      files: [
        file("screenshots/apple/iphone/en/01.png", new Uint8Array([1, 2, 3])),
        file("screenshots/apple/iphone/en/01.PNG"),
        file("assets/.private/icon.png"),
        file("../outside.png"),
      ],
      limits: { maxFiles: 10, maxBytes: png.byteLength * 4, maxPathBytes: 128 },
    });

    expect(discovery.captures).toEqual([]);
    expect(discovery.assets).toEqual([]);
    expect(discovery.invalidEntries.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "unsafe-path", path: "../outside.png" },
      { code: "hidden-path", path: "assets/.private/icon.png" },
      { code: "duplicate-path", path: "screenshots/apple/iphone/en/01.PNG" },
      { code: "duplicate-path", path: "screenshots/apple/iphone/en/01.png" },
    ]);
  });

  it("uses locale-independent portable ordering and casing", () => {
    const discovery = discoverCaptureImport({
      files: [
        file("apple/iphone/tr/z.png"),
        file("apple/iphone/tr/I.png"),
        file("apple/iphone/tr/i.PNG"),
        file("apple/iphone/tr/ä.png"),
      ],
    });

    expect(discovery.captures.map(({ sourcePath }) => sourcePath)).toEqual([
      "apple/iphone/tr/z.png",
      "apple/iphone/tr/ä.png",
    ]);
    expect(discovery.invalidEntries.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "duplicate-path", path: "apple/iphone/tr/I.png" },
      { code: "duplicate-path", path: "apple/iphone/tr/i.PNG" },
    ]);
  });

  it("rejects transient related assets", () => {
    const discovery = discoverCaptureImport({
      files: [file("assets/import.stage", new Uint8Array([1, 2, 3]))],
    });

    expect(discovery.assets).toEqual([]);
    expect(discovery.invalidEntries).toMatchObject([{
      code: "unsupported-asset",
      path: "assets/import.stage",
    }]);
  });

  it("reports malformed PNG bytes when the capture path itself is otherwise valid", () => {
    const discovery = discoverCaptureImport({
      files: [file("apple/iphone/en/01.png", new Uint8Array([1, 2, 3]))],
    });

    expect(discovery.captures).toEqual([]);
    expect(discovery.invalidEntries).toEqual([{
      code: "invalid-png",
      path: "apple/iphone/en/01.png",
      message: "Capture is not a valid PNG: apple/iphone/en/01.png",
    }]);
  });

  it("rejects the whole input when configured file or byte limits are exceeded", () => {
    expect(() => discoverCaptureImport({
      files: [file("apple/iphone/en/01.png"), file("apple/iphone/en/02.png")],
      limits: { maxFiles: 1, maxBytes: png.byteLength * 2, maxPathBytes: 1_024 },
    })).toThrow(/file limit/i);
    expect(() => discoverCaptureImport({
      files: [file("apple/iphone/en/01.png")],
      limits: { maxFiles: 2, maxBytes: png.byteLength - 1, maxPathBytes: 1_024 },
    })).toThrow(/byte limit/i);
  });
});

describe("planCaptureImport", () => {
  it("uses runtime catalog labels in discovery summaries and generated screen names", () => {
    const specs = structuredClone(DEFAULT_STORE_SPECS);
    Object.assign(specs.platforms.apple, { label: "Custom Store" });
    Object.assign(specs.platforms.apple.families.iphone, { label: "Custom Phone" });
    const discovery = discoverCaptureImport({
      files: [file("apple/iphone/fr/02.png")],
      specs,
    });
    const plan = planCaptureImport({
      project: sampleProject(),
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
      specs,
    });

    expect(discovery.summary.platforms).toEqual([{ id: "Custom Store", count: 1 }]);
    expect(discovery.summary.devices).toEqual([{ id: "Custom Store · Custom Phone", count: 1 }]);
    expect(plan.project.layouts[0]!.screens.at(-1)!.name).toBe("Custom Store · Custom Phone · fr · 02");
  });

  it("accepts only the exact server-planned confirmation fingerprint", () => {
    const plan = planCaptureImport({
      project: sampleProject(),
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files: [file("apple/iphone/en/01.png")] }),
    });

    expect(() => assertCaptureImportConfirmation(plan, plan.confirmationFingerprint)).not.toThrow();
    expect(() => assertCaptureImportConfirmation(plan, "0".repeat(64))).toThrow(/preview changed/i);
    expect(() => assertCaptureImportConfirmation(plan, undefined)).toThrow(/preview changed/i);
  });

  it("previews the explicit receiver with deterministic fresh IDs, paths, and a strict Project", () => {
    const project = sampleProject();
    const discovery = discoverCaptureImport({
      files: [
        file("apple/iphone/en/01.png"),
        file("apple/iphone/fr/02.png"),
        file("assets/icons/product.png", new Uint8Array([1, 2, 3])),
      ],
    });

    const first = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
    });
    const repeated = planCaptureImport({
      project: structuredClone(project),
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
    });

    expect(first.receiving).toEqual({
      kind: "current-project",
      projectName: "Import Project",
      layoutId: "default",
      layoutName: "Feature campaign",
    });
    expect(first.summary).toEqual(discovery.summary);
    expect(first.screens.map(({ sourcePath, screenId, elementId, resourcePath }) => ({
      sourcePath,
      screenId,
      elementId,
      resourcePath,
    }))).toEqual([
      {
        sourcePath: "apple/iphone/en/01.png",
        screenId: "apple-iphone-en-01-2",
        elementId: "apple-iphone-en-01-2-screenshot",
        resourcePath: expect.stringMatching(/^assets\/imports\/apple-iphone-en-01-2-[0-9a-f]{12}\.png$/),
      },
      {
        sourcePath: "apple/iphone/fr/02.png",
        screenId: "apple-iphone-fr-02",
        elementId: "apple-iphone-fr-02-screenshot",
        resourcePath: expect.stringMatching(/^assets\/imports\/apple-iphone-fr-02-[0-9a-f]{12}\.png$/),
      },
    ]);
    expect(first.resources.map(({ sourcePath, destinationPath }) => ({
      sourcePath,
      destinationPath,
    }))).toEqual([
      {
        sourcePath: "apple/iphone/en/01.png",
        destinationPath: first.screens[0]!.resourcePath,
      },
      {
        sourcePath: "apple/iphone/fr/02.png",
        destinationPath: first.screens[1]!.resourcePath,
      },
      {
        sourcePath: "assets/icons/product.png",
        destinationPath: "assets/icons/product.png",
      },
    ]);
    expect(first.confirmationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(repeated).toEqual(first);
    expect(Project.parse(first.project)).toEqual(first.project);
    expect(first.project.layouts[0]!.screens).toHaveLength(3);
    expect(first.canApply).toBe(true);
  });

  it("disables apply when a related asset collides with a generated capture resource", () => {
    const project = sampleProject();
    const captureOnly = discoverCaptureImport({ files: [file("apple/iphone/fr/02.png")] });
    const generatedPath = `assets/imports/apple-iphone-fr-02-${captureOnly.captures[0]!.digest.slice(0, 12)}.png`;
    const discovery = discoverCaptureImport({
      files: [
        file("apple/iphone/fr/02.png"),
        file(generatedPath, new Uint8Array([1, 2, 3])),
      ],
    });

    const plan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
    });

    expect(plan.canApply).toBe(false);
    expect(plan.invalidEntries).toMatchObject([{
      code: "destination-conflict",
      path: generatedPath,
    }]);
  });

  it("detects case-folded destination collisions on portable filesystems", () => {
    const project = sampleProject();
    const captureOnly = discoverCaptureImport({ files: [file("apple/iphone/fr/02.png")] });
    const generatedName = `apple-iphone-fr-02-${captureOnly.captures[0]!.digest.slice(0, 12)}.png`;
    const conflictingPath = `assets/IMPORTS/${generatedName}`;
    const discovery = discoverCaptureImport({
      files: [
        file("apple/iphone/fr/02.png"),
        file(conflictingPath, new Uint8Array([1, 2, 3])),
      ],
    });

    const plan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
    });

    expect(plan.canApply).toBe(false);
    expect(plan.invalidEntries).toMatchObject([{
      code: "destination-conflict",
      path: conflictingPath,
    }]);
  });

  it("keeps invalid entries visible but disables application", () => {
    const plan = planCaptureImport({
      project: sampleProject(),
      layoutId: "default",
      destinationKind: "new-project",
      discovery: discoverCaptureImport({
        files: [file("apple/iphone/en/01.png", new Uint8Array([1, 2, 3]))],
      }),
    });

    expect(plan.receiving).toMatchObject({ kind: "new-project", projectName: "Import Project" });
    expect(plan.invalidEntries).toHaveLength(1);
    expect(plan.canApply).toBe(false);
  });

  it("rejects applying a preview to a changed Project or a preview with invalid entries", () => {
    const project = sampleProject();
    const validPlan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files: [file("apple/iphone/fr/02.png")] }),
    });
    const changed = structuredClone(project);
    changed.meta.name = "Changed";

    expect(() => applyCaptureImportPlan(changed, validPlan)).toThrow(/project changed/i);

    const invalidPlan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({
        files: [file("apple/iphone/en/01.png", new Uint8Array([1, 2, 3]))],
      }),
    });
    expect(() => applyCaptureImportPlan(project, invalidPlan)).toThrow(/invalid entries/i);
  });

  it("returns the planned strict Project and exact resource publications without mutating inputs", () => {
    const project = sampleProject();
    const original = structuredClone(project);
    const discovery = discoverCaptureImport({ files: [file("android/phone/es/03.png")] });
    const plan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
    });

    const applied = applyCaptureImportPlan(project, plan);

    expect(project).toEqual(original);
    expect(applied.project).toEqual(plan.project);
    expect(applied.resources).toEqual(plan.resources);
    expect(Project.parse(applied.project)).toEqual(applied.project);
  });

  it("rejects a preview whose planned Project or resource bytes were changed after planning", () => {
    const project = sampleProject();
    const plan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files: [file("android/phone/es/03.png")] }),
    });
    const changedProject = structuredClone(plan);
    changedProject.project.meta.name = "Tampered";
    const changedResource = structuredClone(plan);
    const changedBytes = changedResource.resources[0]!.bytes;
    changedBytes[0] = (changedBytes[0] ?? 0) ^ 0xff;

    expect(() => applyCaptureImportPlan(project, changedProject)).toThrow(/preview changed/i);
    expect(() => applyCaptureImportPlan(project, changedResource)).toThrow(/preview changed/i);
  });
});
