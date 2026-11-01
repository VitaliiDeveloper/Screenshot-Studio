// SPDX-License-Identifier: Apache-2.0

export type CredentialStoreId = "google" | "apple";

export interface StoreCredentialStatus {
  configured: boolean;
  updatedAt: string | null;
}

/** Stores the editor knows about. `uploads` is true once `screenshots upload --store <id>` exists. */
export const UPLOAD_STORES = [
  { id: "google", label: "Google Play", identifierLabel: "Package name", uploads: true },
  { id: "apple", label: "App Store Connect", identifierLabel: "Apple ID", uploads: true },
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

export interface AppStorePlanSet {
  displayType: string;
  upload: UploadPlanImage[];
  /** Current screenshots replaced; null until the store has been read (plans are computed offline). */
  replace: { id: string }[] | null;
}

export interface AppStorePlanLocale {
  platform: string;
  locale: string;
  projectLocale: string;
  sets: AppStorePlanSet[];
}

export interface AppStorePlanView {
  locales: AppStorePlanLocale[];
  skipped: Array<UploadPlanSkipped & { reason: string }>;
}

export interface AppStoreVersionChoice {
  platform: string;
  /** Editable versions App Store Connect lists for the platform. */
  editable: { versionString: string; state: string }[];
  /** The version whose screenshots are replaced; null while the user has to pick one. */
  selected: string | null;
}

/**
 * Version strings the user can pick. The CLI takes one `--version` for every platform with several
 * editable versions, so only strings all of them list qualify.
 */
export function appStoreVersionOptions(versions: readonly AppStoreVersionChoice[]): string[] {
  const ambiguous = versions.filter(({ editable }) => editable.length > 1);
  if (ambiguous.length === 0) return [];
  return ambiguous[0]!.editable.map(({ versionString }) => versionString)
    .filter((versionString) => ambiguous.every(({ editable }) => editable.some((version) => version.versionString === versionString)));
}

export function uploadImageCount(plan: { locales: ReadonlyArray<{ slots: UploadPlanSlot[] } | { sets: AppStorePlanSet[] }> }): number {
  return plan.locales.flatMap((locale): Array<{ upload: unknown[] }> => ("slots" in locale ? locale.slots : locale.sets))
    .reduce((sum, { upload }) => sum + upload.length, 0);
}

interface UploadPlanBase {
  identifier: string;
  layoutId: string;
  revision: string;
  warnings: string[];
  credentialsConfigured: boolean;
  planHash: string;
}

export type UploadPlanResponse =
  | UploadPlanBase & { store: "google"; plan: UploadPlanView }
  | UploadPlanBase & {
    store: "apple";
    plan: AppStorePlanView;
    /** Read from App Store Connect per touched platform; null without a configured key. */
    versions: AppStoreVersionChoice[] | null;
    /** The picked version string, when a platform has several editable versions. */
    version: string | null;
    /** Why this plan cannot be uploaded even once a version is picked. */
    blocked: string | null;
  };

/** `screenshots upload --json` output. */
export interface GooglePlayUploadReport extends UploadPlanView {
  store: "google";
  packageName: string;
  layoutId: string;
  dryRun: boolean;
  committed: boolean;
}

export type AppStoreSetState = "untouched" | "replaced" | "partial" | "failed";

/** `screenshots upload --store apple --json` output. */
export interface AppStoreUploadReport {
  store: "apple";
  appId: string;
  layoutId: string;
  dryRun: boolean;
  versions: { platform: string; versionString: string; state: string }[];
  locales: Array<Omit<AppStorePlanLocale, "sets"> & {
    sets: Array<AppStorePlanSet & { state: AppStoreSetState; error?: string }>;
  }>;
  skipped: AppStorePlanView["skipped"];
}

export type UploadReport = GooglePlayUploadReport | AppStoreUploadReport;

export const UPLOAD_SLOT_LIMITS: Record<UploadStoreId, string> = {
  google: "Google Play keeps at most 8 screenshots per image type and language, and 1 feature graphic.",
  apple: "App Store Connect keeps at most 10 screenshots per display type and language; each touched set is replaced as a whole.",
};
