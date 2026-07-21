// SPDX-License-Identifier: Apache-2.0

/** Export behavior is intentionally independent from screen platform identity. */
export const EXPORT_PROFILES = ["store-bundle", "web-share"] as const;
export type ExportProfile = (typeof EXPORT_PROFILES)[number];

export function parseExportProfile(value: string | undefined): ExportProfile {
  if (value === undefined || value === "store-bundle") return "store-bundle";
  if (value === "web-share") return value;
  throw new Error(`Unsupported export profile: ${value}`);
}
