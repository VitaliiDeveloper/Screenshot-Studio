// SPDX-License-Identifier: Apache-2.0
import { posix } from "node:path";
import {
  DEFAULT_STORE_SPECS,
  artboardTargetStatus,
  destinationLabel,
  findStoreTarget,
  inspectPng,
  leadStoreSizeId,
  outputFamilyLabel,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { isProjectRelativePath, parseScreenPlacement } from "@screenshot-studio/core/model";
import { issue, warning } from "./diagnostics.js";
import { digest, jsonDigest } from "./digest.js";
import { comparePortable, portablePathKey } from "./portable-path.js";
import type {
  CaptureImportCount,
  CaptureImportDiscovery,
  CaptureImportInputFile,
  CaptureImportIssue,
  CaptureImportLimits,
  CaptureImportWarning,
  DiscoveredCapture,
  DiscoveredCaptureAsset,
} from "./types.js";

const PRIVATE_ASSET_BASENAME = /(?:^|[-_.])(?:credentials?|secrets?|service-account|id_rsa|id_ed25519)(?:[-_.]|$)/iu;
const PRIVATE_ASSET_EXTENSION = /\.(?:key|pem|p12|pfx|jks|keystore|mobileprovision)$/iu;
const TRANSIENT_ASSET_BASENAME = /(?:^|\.)(?:lock|tmp|temp|stage)(?:\.|$)/iu;

export const DEFAULT_CAPTURE_IMPORT_LIMITS: Readonly<CaptureImportLimits> = Object.freeze({
  maxFiles: 1_000,
  maxBytes: 512 * 1024 * 1024,
  maxPathBytes: 1_024,
  maxEntries: 2_000,
});

function normalizedFiles(files: readonly CaptureImportInputFile[]): CaptureImportInputFile[] {
  if (files.length === 0) return [];
  const firstSegments = files.map(({ relativePath }) => relativePath.split("/")[0]);
  const sharedRoot = firstSegments[0];
  if (!sharedRoot || !firstSegments.every((segment) => segment === sharedRoot)) return [...files];
  const stripped = files.map((file) => ({
    ...file,
    relativePath: file.relativePath.split("/").slice(1).join("/"),
  }));
  return stripped.every(({ relativePath }) => (
    relativePath.startsWith("screenshots/") || relativePath.startsWith("assets/")
  )) ? stripped : [...files];
}

function count(values: readonly string[]): CaptureImportCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([id, value]) => ({ id, count: value }))
    .sort((left, right) => comparePortable(left.id, right.id));
}

function hasHiddenSegment(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function supportedAsset(path: string): boolean {
  const basename = posix.basename(path);
  return !PRIVATE_ASSET_BASENAME.test(basename)
    && !PRIVATE_ASSET_EXTENSION.test(basename)
    && !TRANSIENT_ASSET_BASENAME.test(basename);
}

export function resolveCaptureImportLimits(
  limits: Partial<CaptureImportLimits> | undefined,
): CaptureImportLimits {
  const resolved = {
    maxFiles: limits?.maxFiles ?? DEFAULT_CAPTURE_IMPORT_LIMITS.maxFiles,
    maxBytes: limits?.maxBytes ?? DEFAULT_CAPTURE_IMPORT_LIMITS.maxBytes,
    maxPathBytes: limits?.maxPathBytes ?? DEFAULT_CAPTURE_IMPORT_LIMITS.maxPathBytes,
    maxEntries: limits?.maxEntries ?? DEFAULT_CAPTURE_IMPORT_LIMITS.maxEntries,
  };
  if (!Number.isSafeInteger(resolved.maxFiles) || resolved.maxFiles <= 0
    || !Number.isSafeInteger(resolved.maxBytes) || resolved.maxBytes <= 0
    || !Number.isSafeInteger(resolved.maxPathBytes) || resolved.maxPathBytes <= 0
    || !Number.isSafeInteger(resolved.maxEntries) || resolved.maxEntries <= 0) {
    throw new TypeError("Capture import limits must be positive safe integers");
  }
  return resolved;
}

export function discoverCaptureImport(input: {
  files: readonly CaptureImportInputFile[];
  limits?: Partial<CaptureImportLimits>;
  specs?: StoreSpecs;
}): CaptureImportDiscovery {
  const limits = resolveCaptureImportLimits(input.limits);
  const specs = input.specs ?? DEFAULT_STORE_SPECS;
  if (input.files.length > limits.maxFiles) {
    throw new Error("Capture import exceeds the configured file limit");
  }
  let totalBytes = 0;
  for (const file of input.files) {
    if (!(file.bytes instanceof Uint8Array)) {
      throw new TypeError("Capture import bytes must be Uint8Array values");
    }
    totalBytes += file.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxBytes) {
      throw new Error("Capture import exceeds the configured byte limit");
    }
  }

  const files = normalizedFiles(input.files);
  const invalidEntries: CaptureImportIssue[] = [];
  const warnings: CaptureImportWarning[] = [];
  const invalidPaths = new Set<string>();
  const foldedGroups = new Map<string, CaptureImportInputFile[]>();

  for (const file of files) {
    const path = file.relativePath;
    if (!isProjectRelativePath(path)) {
      invalidEntries.push(issue("unsafe-path", path, `Input path is not portable or contained: ${path}`));
      invalidPaths.add(path);
      continue;
    }
    if (new TextEncoder().encode(path).byteLength > limits.maxPathBytes) {
      invalidEntries.push(issue("path-too-long", path, `Input path exceeds the configured limit: ${path}`));
      invalidPaths.add(path);
      continue;
    }
    if (hasHiddenSegment(path)) {
      invalidEntries.push(issue("hidden-path", path, `Hidden input paths are not supported: ${path}`));
      invalidPaths.add(path);
      continue;
    }
    const folded = portablePathKey(path);
    const group = foldedGroups.get(folded) ?? [];
    group.push(file);
    foldedGroups.set(folded, group);
  }

  for (const group of foldedGroups.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      invalidEntries.push(issue(
        "duplicate-path",
        file.relativePath,
        `Input contains a duplicate portable path: ${file.relativePath}`,
      ));
      invalidPaths.add(file.relativePath);
    }
  }

  const captures: DiscoveredCapture[] = [];
  const assets: DiscoveredCaptureAsset[] = [];
  for (const file of files) {
    const sourcePath = file.relativePath;
    if (invalidPaths.has(sourcePath)) continue;
    if (sourcePath.startsWith("assets/")) {
      if (!supportedAsset(sourcePath)) {
        invalidEntries.push(issue(
          "unsupported-asset",
          sourcePath,
          `Asset path is sensitive or unsupported: ${sourcePath}`,
        ));
        continue;
      }
      assets.push({
        sourcePath,
        destinationPath: sourcePath,
        digest: digest(file.bytes),
        bytes: new Uint8Array(file.bytes),
      });
      continue;
    }

    const capturePath = sourcePath.startsWith("screenshots/")
      ? sourcePath.slice("screenshots/".length)
      : sourcePath;
    const segments = capturePath.split("/");
    const filename = segments[3];
    if (segments.length !== 4 || !filename?.toLowerCase().endsWith(".png")) {
      warnings.push(warning(
        "unsupported-input",
        sourcePath,
        `Skipping unsupported input "${sourcePath}"`,
      ));
      continue;
    }
    const [platform, device, locale] = segments;
    const placement = parseScreenPlacement(platform!, device!);
    if (!placement) {
      warnings.push(warning(
        "unsupported-capture-path",
        sourcePath,
        `Skipping unsupported capture path "${sourcePath}"`,
      ));
      continue;
    }
    let dimensions: ReturnType<typeof inspectPng>;
    try {
      dimensions = inspectPng(Buffer.from(file.bytes));
    } catch {
      invalidEntries.push(issue(
        "invalid-png",
        sourcePath,
        `Capture is not a valid PNG: ${sourcePath}`,
      ));
      continue;
    }
    // Imported screens are primary screens that keep the capture size as their artboard. They
    // export at the family lead, and export refuses any aspect change.
    const { platform: capturePlatform, device: captureDevice } = placement;
    const lead = findStoreTarget(
      specs,
      capturePlatform,
      captureDevice,
      leadStoreSizeId(specs, capturePlatform, captureDevice),
    );
    if (artboardTargetStatus(dimensions, lead).kind === "invalid") {
      warnings.push(warning(
        "unexportable-capture-size",
        sourcePath,
        `Capture is ${dimensions.width}×${dimensions.height}, which does not match the `
          + `${outputFamilyLabel(capturePlatform, captureDevice, specs)} lead size `
          + `${lead.width}×${lead.height} aspect ratio; it imports, but export will fail`,
      ));
    }
    captures.push({
      sourcePath,
      ...placement,
      locale: locale!,
      filename,
      width: dimensions.width,
      height: dimensions.height,
      digest: digest(file.bytes),
      bytes: new Uint8Array(file.bytes),
    });
  }

  captures.sort((left, right) => comparePortable(left.sourcePath, right.sourcePath));
  assets.sort((left, right) => comparePortable(left.sourcePath, right.sourcePath));
  warnings.sort((left, right) => comparePortable(left.path, right.path));
  invalidEntries.sort((left, right) => comparePortable(left.path, right.path));
  const summary = {
    screenCount: captures.length,
    assetCount: assets.length,
    platforms: count(captures.map(({ platform }) => destinationLabel(platform, specs))),
    devices: count(captures.map(({ platform, device }) => outputFamilyLabel(platform, device, specs))),
    locales: count(captures.map(({ locale }) => locale)),
  };
  const fingerprint = jsonDigest({
    captures: captures.map(({ sourcePath, digest: revision }) => ({ sourcePath, digest: revision })),
    assets: assets.map(({ sourcePath, destinationPath, digest: revision }) => ({
      sourcePath,
      destinationPath,
      digest: revision,
    })),
    warnings,
    invalidEntries,
  });
  return { captures, assets, summary, warnings, invalidEntries, fingerprint };
}
