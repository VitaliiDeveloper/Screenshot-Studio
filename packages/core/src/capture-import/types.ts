// SPDX-License-Identifier: Apache-2.0
import type { Project as ProjectModel, ScreenPlacement } from "@screenshot-studio/core/model";

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

export type CaptureImportIssueCode =
  | "duplicate-capture-key"
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

export type CaptureImportWarningCode =
  | "unmatched-capture"
  | "unexportable-capture-size"
  | "unsupported-capture-path"
  | "unsupported-input";

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

/** `add` creates one screen per capture; `refresh` only repoints existing references to new bytes. */
export type CaptureImportMode = "add" | "refresh";

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

export interface CaptureImportPlannedRefresh {
  sourcePath: string;
  captureKey: string;
  resourcePath: string;
  previousPaths: string[];
  references: Array<{ screenId: string; elementId: string | null }>;
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
  mode: CaptureImportMode;
  summary: CaptureImportDiscovery["summary"];
  screens: CaptureImportPlannedScreen[];
  refreshes: CaptureImportPlannedRefresh[];
  /** Refresh-mode captures whose references already point at identical bytes. */
  unchanged: string[];
  resources: CaptureImportPlannedResource[];
  warnings: CaptureImportWarning[];
  invalidEntries: CaptureImportIssue[];
  project: ProjectModel;
  canApply: boolean;
  confirmationFingerprint: string;
  baseProjectFingerprint: string;
}
