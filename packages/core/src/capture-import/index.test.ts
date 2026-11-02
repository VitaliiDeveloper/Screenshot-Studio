// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS, findStoreTarget } from "@screenshot-studio/core/export";
import {
  Project,
  ensureStoreTargetVariant,
  setOutputFamilyScreenSetMode,
  type Project as ProjectModel,
} from "@screenshot-studio/core/model";
import {
  applyCaptureImportPlan,
  assertCaptureImportConfirmation,
  captureImportKey,
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
    // The square fixture fits no phone export size, so each capture carries a size warning.
    expect(discovery.warnings.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "unexportable-capture-size", path: "screenshots/android/phone/en/02.png" },
      { code: "unexportable-capture-size", path: "screenshots/apple/iphone/en/01.png" },
    ]);
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
    expect(discovery.warnings).toMatchObject([
      { code: "unexportable-capture-size", path: "android/tablet-7/en/01.png" },
      { code: "unexportable-capture-size", path: "apple/ipad/fr/02.PNG" },
      {
        code: "unsupported-input",
        path: "notes.txt",
        message: "Skipping unsupported input \"notes.txt\"",
      },
    ]);
    expect(discovery.invalidEntries).toEqual([]);
  });

  it("warns, without blocking apply, when a capture aspect does not match its family lead size", () => {
    const capture = (width: number, height: number) => PNG.sync.write(new PNG({ width, height }));
    const discovery = discoverCaptureImport({
      files: [
        // 920×2000 downscaled capture: no iPhone size shares its aspect ratio.
        file("apple/iphone/en/01.png", capture(23, 50)),
        // Proportional to the 6.3" lead size (1206×2622).
        file("apple/iphone/en/02.png", capture(201, 437)),
        // Proportional to the non-lead 6.9" size (1320×2868): primary screens export at the lead.
        file("apple/iphone/en/03.png", capture(110, 239)),
      ],
    });

    expect(discovery.captures).toHaveLength(3);
    const message = (size: string) => `Capture is ${size}, which does not match the App Store · iPhone `
      + "lead size 1206×2622 aspect ratio; it imports, but export will fail";
    expect(discovery.warnings).toEqual([
      { code: "unexportable-capture-size", path: "apple/iphone/en/01.png", message: message("23×50") },
      { code: "unexportable-capture-size", path: "apple/iphone/en/03.png", message: message("110×239") },
    ]);
    const plan = planCaptureImport({
      project: sampleProject(),
      layoutId: "default",
      destinationKind: "current-project",
      discovery,
    });
    expect(plan.warnings).toEqual(discovery.warnings);
    expect(plan.canApply).toBe(true);
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

  it("rejects a capture over the image pixel limit before decoding it", () => {
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const side = 9_000;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(side, 0);
    header.writeUInt32BE(side, 4);
    header[8] = 1;
    // 1-bit grayscale zero rows deflate to a few KB but decode to ~324 MB of RGBA.
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc((1 + Math.ceil(side / 8)) * side))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const decode = vi.spyOn(PNG.sync, "read");

    const discovery = discoverCaptureImport({ files: [file("apple/iphone/en/01.png", huge)] });

    expect(discovery.invalidEntries.map(({ code }) => code)).toEqual(["invalid-png"]);
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
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

  it("confirms a re-planned preview that adds exact-size variants to a synchronized family", () => {
    const synchronized = setOutputFamilyScreenSetMode(sampleProject(), "default", "apple-iphone-en-01", "synchronized");
    const target = findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", "6.5");
    const project = ensureStoreTargetVariant(synchronized, "default", "apple-iphone-en-01", target).project;
    const discovery = discoverCaptureImport({ files: [file("apple/iphone/en/home.png")] });
    const plan = () => planCaptureImport({
      project, layoutId: "default", destinationKind: "current-project", discovery,
    });

    const preview = plan();
    const replanned = plan();

    expect(replanned.project.layouts[0]!.screens.filter(({ variantOf }) => variantOf === "apple-iphone-en-home"))
      .toHaveLength(1);
    expect(() => assertCaptureImportConfirmation(replanned, preview.confirmationFingerprint)).not.toThrow();
    expect(() => applyCaptureImportPlan(project, replanned)).not.toThrow();
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
        resourcePath: expect.stringMatching(/^assets\/imports\/apple-iphone-en-01-[0-9a-f]{12}\.png$/),
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

describe("planCaptureImport refresh mode", () => {
  // Proportional to the iPhone lead size, so discovery adds no size warnings.
  const shot = (fill: number) => {
    const image = new PNG({ width: 201, height: 437 });
    image.data.fill(fill);
    return new Uint8Array(PNG.sync.write(image));
  };
  const importPath = (key: string, bytes: Uint8Array) =>
    `assets/imports/${key}-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.png`;

  function imported(files: CaptureImportInputFile[], project = sampleProject()): ProjectModel {
    const plan = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files }),
    });
    return applyCaptureImportPlan(project, plan).project;
  }

  function refresh(project: ProjectModel, files: CaptureImportInputFile[]) {
    return planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files }),
      mode: "refresh",
    });
  }

  const screen = (project: ProjectModel, id: string) =>
    project.layouts[0]!.screens.find((candidate) => candidate.id === id)!;

  it("pins the persisted capture key derivation", () => {
    expect(captureImportKey({ platform: "apple", device: "iphone", locale: "en-US", filename: "01 Home Screen.PNG" }))
      .toBe("apple-iphone-en-us-01-home-screen");
    expect(captureImportKey({ platform: "android", device: "phone", locale: "ru", filename: "Главная.png" }))
      .toBe("android-phone-ru");
  });

  it("names add-mode resources by capture key even when the screen id needs a suffix", () => {
    const bytes = shot(10);
    const project = imported([file("apple/iphone/en/01.png", bytes)]);

    expect(screen(project, "apple-iphone-en-01-2").elements[0])
      .toMatchObject({ assetUrl: importPath("apple-iphone-en-01", bytes) });
  });

  it("repoints an imported screenshot to re-captured bytes without touching screens", () => {
    const first = shot(10);
    const second = shot(20);
    const key = "apple-iphone-en-01-home";
    const project = imported([file("apple/iphone/en/01 Home.png", first)]);

    const plan = refresh(project, [file("apple/iphone/en/01 Home.png", second)]);

    expect(plan.mode).toBe("refresh");
    expect(plan.screens).toEqual([]);
    expect(plan.refreshes).toEqual([{
      sourcePath: "apple/iphone/en/01 Home.png",
      captureKey: key,
      resourcePath: importPath(key, second),
      previousPaths: [importPath(key, first)],
      references: [{ screenId: key, elementId: `${key}-screenshot` }],
    }]);
    expect(plan.resources.map(({ destinationPath }) => destinationPath)).toEqual([importPath(key, second)]);
    expect(plan.canApply).toBe(true);
    const applied = applyCaptureImportPlan(project, plan).project;
    expect(applied.layouts[0]!.screens.map(({ id }) => id)).toEqual(["apple-iphone-en-01", key]);
    const expected = structuredClone(screen(project, key));
    expected.elements[0] = { ...expected.elements[0]!, assetUrl: importPath(key, second) } as typeof expected.elements[0];
    expect(screen(applied, key)).toEqual(expected);
  });

  it("refreshes backgrounds, images, device frames in groups, and duplicated screens", () => {
    const first = shot(10);
    const second = shot(20);
    const key = "apple-iphone-en-01";
    const base = imported([file("apple/iphone/en/01.png", first)]);
    const oldPath = importPath(key, first);
    const project = Project.parse({
      ...base,
      layouts: [{
        ...base.layouts[0]!,
        screens: [...base.layouts[0]!.screens, {
          ...screen(base, `${key}-2`),
          id: "designed",
          background: { type: "image", assetUrl: oldPath, fit: "cover", color: "#000000" },
          elements: [
            { type: "image", id: "decor", x: 0, y: 0, width: 10, height: 10, assetUrl: oldPath },
            {
              type: "group", id: "group", x: 0, y: 0, width: 100, height: 100,
              children: [
                { type: "device-frame", id: "frame", x: 0, y: 0, width: 100, height: 100, deviceType: "iphone", assetUrl: oldPath },
                { type: "screenshot", id: "kept", x: 0, y: 0, width: 10, height: 10, assetUrl: "assets/other.png" },
              ],
            },
          ],
        }],
      }],
    });

    const plan = refresh(project, [file("apple/iphone/en/01.png", second)]);

    expect(plan.refreshes[0]!.references).toEqual([
      { screenId: `${key}-2`, elementId: `${key}-2-screenshot` },
      { screenId: "designed", elementId: null },
      { screenId: "designed", elementId: "decor" },
      { screenId: "designed", elementId: "frame" },
    ]);
    const designed = screen(applyCaptureImportPlan(project, plan).project, "designed");
    const newPath = importPath(key, second);
    expect(designed.background).toMatchObject({ assetUrl: newPath });
    expect(designed.elements[0]).toMatchObject({ assetUrl: newPath });
    expect(designed.elements[1]).toMatchObject({
      children: [{ assetUrl: newPath }, { assetUrl: "assets/other.png" }],
    });
  });

  it("leaves references the user re-pointed alone and reports the capture as unmatched", () => {
    const first = shot(10);
    const base = imported([file("apple/iphone/en/02.png", first)]);
    const project = Project.parse(structuredClone(base));
    const element = screen(project, "apple-iphone-en-02").elements[0]!;
    if (element.type === "screenshot") element.assetUrl = "assets/hero.png";

    const plan = refresh(project, [file("apple/iphone/en/02.png", shot(20))]);

    expect(plan.refreshes).toEqual([]);
    expect(plan.resources).toEqual([]);
    expect(plan.warnings.map(({ code, path }) => ({ code, path })))
      .toEqual([{ code: "unmatched-capture", path: "apple/iphone/en/02.png" }]);
    expect(plan.canApply).toBe(false);
    expect(plan.project).toEqual(project);
  });

  it("treats identical bytes as unchanged and plans nothing", () => {
    const bytes = shot(10);
    const project = imported([file("apple/iphone/en/02.png", bytes)]);

    const plan = refresh(project, [file("apple/iphone/en/02.png", bytes)]);

    expect(plan.unchanged).toEqual(["apple/iphone/en/02.png"]);
    expect(plan.refreshes).toEqual([]);
    expect(plan.resources).toEqual([]);
    expect(plan.canApply).toBe(false);
  });

  it("refuses two captures that share one capture key", () => {
    const project = imported([file("apple/iphone/en/01 Home.png", shot(10))]);

    const plan = refresh(project, [
      file("apple/iphone/en/01 Home.png", shot(20)),
      file("apple/iphone/en/01-home.png", shot(30)),
    ]);

    expect(plan.invalidEntries.map(({ code }) => code)).toEqual(["duplicate-capture-key"]);
    expect(plan.canApply).toBe(false);
    expect(plan.project).toEqual(project);
  });

  it.each([
    ["apple/iphone/uk/Головна.png", "apple/iphone/uk/Налаштування.png"],
    ["apple/iphone/en/Hero_1.png", "apple/iphone/en/hero-1.png"],
  ])("refuses to add %s and %s under one capture key", (first, second) => {
    const plan = planCaptureImport({
      project: sampleProject(),
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files: [file(first, shot(10)), file(second, shot(20))] }),
    });

    expect(plan.invalidEntries.map(({ code }) => code)).toEqual(["duplicate-capture-key"]);
    expect(plan.canApply).toBe(false);
  });

  it("refuses to add a capture whose key the layout already uses, so refresh keeps one owner", () => {
    const project = imported([file("apple/iphone/uk/Головна.png", shot(10))]);

    const added = planCaptureImport({
      project,
      layoutId: "default",
      destinationKind: "current-project",
      discovery: discoverCaptureImport({ files: [file("apple/iphone/uk/Налаштування.png", shot(20))] }),
    });

    expect(added.invalidEntries).toMatchObject([{
      code: "duplicate-capture-key",
      path: "apple/iphone/uk/Налаштування.png",
    }]);
    expect(added.canApply).toBe(false);
    expect(refresh(project, [file("apple/iphone/uk/Головна.png", shot(30))]).refreshes[0]!.references)
      .toEqual([{ screenId: "apple-iphone-uk", elementId: "apple-iphone-uk-screenshot" }]);
  });

  it("matches capture keys exactly, never a legacy suffixed resource", () => {
    const legacy = importPath("apple-iphone-en-home-2", shot(10));
    const base = imported([file("apple/iphone/en/home.png", shot(10))]);
    const project = Project.parse(structuredClone(base));
    const element = screen(project, "apple-iphone-en-home").elements[0]!;
    if (element.type === "screenshot") element.assetUrl = legacy;

    const plan = refresh(project, [file("apple/iphone/en/home.png", shot(20))]);

    expect(plan.warnings.map(({ code }) => code)).toEqual(["unmatched-capture"]);
  });

  it("binds the confirmation fingerprint to the mode", () => {
    const project = imported([file("apple/iphone/en/02.png", shot(10))]);
    const discovery = discoverCaptureImport({ files: [file("apple/iphone/en/02.png", shot(20))] });
    const plan = (mode: "add" | "refresh") => planCaptureImport({
      project, layoutId: "default", destinationKind: "current-project", discovery, mode,
    });

    expect(plan("add").confirmationFingerprint).not.toBe(plan("refresh").confirmationFingerprint);
  });
});
