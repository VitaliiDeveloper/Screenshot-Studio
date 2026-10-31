// SPDX-License-Identifier: Apache-2.0

export type CredentialStoreId = "google" | "apple";

export interface StoreCredentialStatus {
  configured: boolean;
  updatedAt: string | null;
}

/**
 * Stores the editor knows about. `uploads` is true once `screenshots upload --store <id>` exists; the
 * Apple entry flips when its CLI exports a plan function and the upload routes handle it.
 */
export const UPLOAD_STORES = [
  { id: "google", label: "Google Play", identifierLabel: "Package name", uploads: true },
  { id: "apple", label: "App Store Connect", identifierLabel: "Apple ID", uploads: false },
] as const satisfies readonly { id: CredentialStoreId; label: string; identifierLabel: string; uploads: boolean }[];

export type UploadStoreId = Extract<(typeof UPLOAD_STORES)[number], { uploads: true }>["id"];

export function isUploadStore(value: unknown): value is UploadStoreId {
  return UPLOAD_STORES.some(({ id, uploads }) => uploads && id === value);
}

export interface UploadPlanImage {
  screenId: string;
  screenName: string;
  sizeId: string;
}

export interface UploadPlanSlot {
  imageType: string;
  upload: UploadPlanImage[];
  /** Current images replaced; null until the store has been read (plans are computed offline). */
  replace: { id: string }[] | null;
}

export interface UploadPlanLocale {
  locale: string;
  projectLocale: string;
  slots: UploadPlanSlot[];
  untouchedSlots: string[];
}

export interface UploadPlanSkipped {
  screenId: string;
  platform: string;
  device: string;
  sizeId: string;
}

/** The plan as the CLI's `--json` report shapes it. */
export interface UploadPlanView {
  locales: UploadPlanLocale[];
  untouchedLocales: string[] | null;
  skipped: UploadPlanSkipped[];
}

export interface UploadPlanResponse {
  store: UploadStoreId;
  identifier: string;
  layoutId: string;
  revision: string;
  plan: UploadPlanView;
  warnings: string[];
  credentialsConfigured: boolean;
  planHash: string;
}

/** `screenshots upload --json` output. */
export interface UploadReport extends UploadPlanView {
  store: UploadStoreId;
  packageName: string;
  layoutId: string;
  dryRun: boolean;
  committed: boolean;
}

export const UPLOAD_SLOT_LIMITS = "Google Play keeps at most 8 screenshots per image type and language, and 1 feature graphic.";
