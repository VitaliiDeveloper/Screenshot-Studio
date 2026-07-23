// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { inspectPng } from "@screenshot-studio/core/export";
import {
  Project,
  addScreenToProject,
  createScreenshotElement,
  getLayout,
  isProjectRelativePath,
  parseScreenPlacement,
  slugify,
  uniqueId,
  type Project as ProjectModel,
  type ScreenPlacement,
} from "@screenshot-studio/core/model";

const IMPORT_DIGEST_LENGTH = 12;
const PRIVATE_ASSET_BASENAME = /(?:^|[-_.])(?:credentials?|secrets?|service-account|id_rsa|id_ed25519)(?:[-_.]|$)/iu;
const PRIVATE_ASSET_EXTENSION = /\.(?:key|pem|p12|pfx|jks|keystore|mobileprovision)$/iu;
const TRANSIENT_ASSET_BASENAME = /(?:^|\.)(?:lock|tmp|temp|stage)(?:\.|$)/iu;

export interface CaptureImportInputFile {
  relativePath: string;
  bytes: Uint8Array;
}

export interface CaptureImportLimits {
  maxFiles: number;
  maxBytes: number;
  maxPathBytes: number;
  maxEntries: number;
}

export const DEFAULT_CAPTURE_IMPORT_LIMITS: Readonly<CaptureImportLimits> = Object.freeze({
  maxFiles: 1_000,
  maxBytes: 512 * 1024 * 1024,
  maxPathBytes: 1_024,
  maxEntries: 2_000,
});

export type CaptureImportIssueCode =
  | "duplicate-path"
  | "destination-conflict"
  | "hidden-path"
  | "invalid-png"
  | "path-too-long"
  | "unsafe-path"
  | "unsupported-asset";

export interface CaptureImportIssue {
  code: CaptureImportIssueCode;
  path: string;
  message: string;
}

export type CaptureImportWarningCode = "unsupported-capture-path" | "unsupported-input";

export interface CaptureImportWarning {
  code: CaptureImportWarningCode;
  path: string;
  message: string;
}

export type DiscoveredCapture = ScreenPlacement & {
  sourcePath: string;
  platform: ScreenPlacement["platform"];
  device: ScreenPlacement["device"];
  locale: string;
  filename: string;
  width: number;
  height: number;
  digest: string;
  bytes: Uint8Array;
};

export interface DiscoveredCaptureAsset {
  sourcePath: string;
  destinationPath: string;
  digest: string;
  bytes: Uint8Array;
}

export interface CaptureImportCount {
  id: string;
  count: number;
}

export interface CaptureImportDiscovery {
  captures: DiscoveredCapture[];
  assets: DiscoveredCaptureAsset[];
  summary: {
    screenCount: number;
    assetCount: number;
    platforms: CaptureImportCount[];
    devices: CaptureImportCount[];
    locales: CaptureImportCount[];
  };
  warnings: CaptureImportWarning[];
  invalidEntries: CaptureImportIssue[];
  fingerprint: string;
}

export type CaptureImportDestinationKind = "current-project" | "new-project";

export interface CaptureImportPlannedScreen {
  sourcePath: string;
  screenId: string;
  elementId: string;
  resourcePath: string;
  platform: ScreenPlacement["platform"];
  device: ScreenPlacement["device"];
  locale: string;
  width: number;
  height: number;
}

export interface CaptureImportPlannedResource {
  sourcePath: string;
  destinationPath: string;
  digest: string;
  bytes: Uint8Array;
}

export interface CaptureImportPlan {
  receiving: {
    kind: CaptureImportDestinationKind;
    projectName: string;
    layoutId: string;
    layoutName: string;
  };
  summary: CaptureImportDiscovery["summary"];
  screens: CaptureImportPlannedScreen[];
  resources: CaptureImportPlannedResource[];
  warnings: CaptureImportWarning[];
  invalidEntries: CaptureImportIssue[];
  project: ProjectModel;
  canApply: boolean;
  confirmationFingerprint: string;
  baseProjectFingerprint: string;
}

export class CaptureImportConfirmationError extends Error {
  override name = "CaptureImportConfirmationError";

  constructor() {
    super("Capture import preview changed; preview again before applying");
  }
}

export class CaptureImportCancelledError extends Error {
  override name = "CaptureImportCancelledError";

  constructor() {
    super("Capture import was cancelled");
  }
}

export function assertCaptureImportNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CaptureImportCancelledError();
}

export function assertCaptureImportConfirmation(
  plan: Pick<CaptureImportPlan, "confirmationFingerprint">,
  confirmationFingerprint: string | undefined,
): void {
  if (confirmationFingerprint !== plan.confirmationFingerprint) {
    throw new CaptureImportConfirmationError();
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonDigest(value: unknown): string {
  return digest(new TextEncoder().encode(JSON.stringify(value)));
}

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

function issue(code: CaptureImportIssueCode, path: string, message: string): CaptureImportIssue {
  return { code, path, message };
}

function warning(
  code: CaptureImportWarningCode,
  path: string,
  message: string,
): CaptureImportWarning {
  return { code, path, message };
}

function count(values: readonly string[]): CaptureImportCount[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([id, value]) => ({ id, count: value }))
    .sort((left, right) => comparePortable(left.id, right.id));
}

function comparePortable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
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
}): CaptureImportDiscovery {
  const limits = resolveCaptureImportLimits(input.limits);
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
    platforms: count(captures.map(({ platform }) => platform)),
    devices: count(captures.map(({ platform, device }) => `${platform}/${device}`)),
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

function displayDevice(device: string): string {
  if (device === "iphone") return "iPhone";
  if (device === "ipad") return "iPad";
  return device.slice(0, 1).toUpperCase() + device.slice(1);
}

function baseProjectFingerprint(project: ProjectModel): string {
  return jsonDigest(Project.parse(project));
}

export function planCaptureImport(input: {
  project: ProjectModel;
  layoutId: string;
  destinationKind: CaptureImportDestinationKind;
  discovery: CaptureImportDiscovery;
}): CaptureImportPlan {
  const base = Project.parse(structuredClone(input.project));
  const layout = getLayout(base, input.layoutId);
  let project = base;
  const screens: CaptureImportPlannedScreen[] = [];
  const captureResources: CaptureImportPlannedResource[] = [];

  for (const capture of input.discovery.captures) {
    const currentLayout = getLayout(project, input.layoutId);
    const stem = posix.parse(capture.filename).name;
    const screenId = uniqueId(
      slugify(`${capture.platform}-${capture.device}-${capture.locale}-${stem}`),
      currentLayout.screens,
    );
    const elementId = `${screenId}-screenshot`;
    const resourcePath = posix.join(
      "assets",
      "imports",
      `${screenId}-${capture.digest.slice(0, IMPORT_DIGEST_LENGTH)}.png`,
    );
    const name = `${capture.platform.slice(0, 1).toUpperCase()}${capture.platform.slice(1)} ${displayDevice(
      capture.device,
    )} ${capture.locale} ${stem}`;
    project = addScreenToProject(project, input.layoutId, {
      ...capture,
      id: screenId,
      name,
      locale: capture.locale,
      artboard: { width: capture.width, height: capture.height },
      elements: [createScreenshotElement({
        id: elementId,
        x: 0,
        y: 0,
        width: capture.width,
        height: capture.height,
        assetUrl: resourcePath,
      })],
    });
    screens.push({
      sourcePath: capture.sourcePath,
      screenId,
      elementId,
      resourcePath,
      platform: capture.platform,
      device: capture.device,
      locale: capture.locale,
      width: capture.width,
      height: capture.height,
    });
    captureResources.push({
      sourcePath: capture.sourcePath,
      destinationPath: resourcePath,
      digest: capture.digest,
      bytes: new Uint8Array(capture.bytes),
    });
  }

  project = Project.parse(project);
  const resources = [
    ...captureResources,
    ...input.discovery.assets.map((asset) => ({
      sourcePath: asset.sourcePath,
      destinationPath: asset.destinationPath,
      digest: asset.digest,
      bytes: new Uint8Array(asset.bytes),
    })),
  ];
  const invalidEntries = structuredClone(input.discovery.invalidEntries);
  const destinations = new Map<string, CaptureImportPlannedResource>();
  for (const resource of resources) {
    const destinationKey = portablePathKey(resource.destinationPath);
    const existing = destinations.get(destinationKey);
    if (existing) {
      invalidEntries.push(issue(
        "destination-conflict",
        resource.destinationPath,
        `Multiple inputs plan the same resource path: ${existing.sourcePath} and ${resource.sourcePath}`,
      ));
    } else {
      destinations.set(destinationKey, resource);
    }
  }
  invalidEntries.sort((left, right) => comparePortable(left.path, right.path));
  const projectFingerprint = baseProjectFingerprint(base);
  const planWithoutFingerprint = {
    receiving: {
      kind: input.destinationKind,
      projectName: base.meta.name,
      layoutId: layout.id,
      layoutName: layout.name,
    },
    summary: structuredClone(input.discovery.summary),
    screens,
    resources,
    warnings: structuredClone(input.discovery.warnings),
    invalidEntries,
    project,
    canApply: screens.length > 0 && invalidEntries.length === 0,
    baseProjectFingerprint: projectFingerprint,
  };
  return {
    ...planWithoutFingerprint,
    confirmationFingerprint: planFingerprint(planWithoutFingerprint),
  };
}

function planFingerprint(plan: Omit<CaptureImportPlan, "confirmationFingerprint">): string {
  return jsonDigest({
    ...plan,
    project: Project.parse(plan.project),
    resources: plan.resources.map(({ bytes, ...resource }) => ({
      ...resource,
      bytesDigest: digest(bytes),
    })),
  });
}

export function withCaptureImportInvalidEntries(
  plan: CaptureImportPlan,
  entries: readonly CaptureImportIssue[],
): CaptureImportPlan {
  if (entries.length === 0) return plan;
  const { confirmationFingerprint: _confirmationFingerprint, ...withoutFingerprint } = plan;
  const next = {
    ...withoutFingerprint,
    invalidEntries: [...withoutFingerprint.invalidEntries, ...structuredClone(entries)]
      .sort((left, right) => comparePortable(left.path, right.path)),
    canApply: false,
  };
  return { ...next, confirmationFingerprint: planFingerprint(next) };
}

export function applyCaptureImportPlan(
  project: ProjectModel,
  plan: CaptureImportPlan,
): { project: ProjectModel; resources: CaptureImportPlannedResource[] } {
  if (baseProjectFingerprint(project) !== plan.baseProjectFingerprint) {
    throw new Error("Capture import target Project changed after preview");
  }
  const { confirmationFingerprint, ...planWithoutFingerprint } = plan;
  if (planFingerprint(planWithoutFingerprint) !== confirmationFingerprint) {
    throw new Error("Capture import preview changed after planning");
  }
  if (!plan.canApply || plan.invalidEntries.length > 0) {
    throw new Error("Capture import preview contains invalid entries");
  }
  return {
    project: Project.parse(structuredClone(plan.project)),
    resources: plan.resources.map((resource) => ({
      ...resource,
      bytes: new Uint8Array(resource.bytes),
    })),
  };
}
