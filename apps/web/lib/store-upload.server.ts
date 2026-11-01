// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  buildBundleEntries,
  bundlePreflightWarnings,
  parseStoreSpecs,
  validateBundleArtboards,
} from "@screenshot-studio/core/export";
import { assertProjectFontsResolved, resolveLayoutReference } from "@screenshot-studio/core/model";
import { readProjectSnapshot, resolveExistingProjectPath } from "@screenshot-studio/core/storage";
import type { AppStoreVersion } from "@screenshot-studio/cli/app-store-connect-client";
import {
  appStoreUploadPlan,
  googlePlayUploadPlan,
  type AppStorePlatform,
  type AppStoreUploadPlan,
  type GooglePlayUploadPlan,
} from "@screenshot-studio/cli/store-upload-plan";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import {
  appStoreVersionOptions,
  type AppStorePlanView,
  type AppStoreVersionChoice,
  type UploadPlanResponse,
  type UploadPlanView,
  type UploadStoreId,
} from "./store-upload.js";

/** The project has no store identifier yet; the Stores dialog sets it. */
export class MissingStoreIdentifierError extends Error {}

/** The requested version is not one the plan offers; a trust-boundary refusal, not a stale plan. */
export class UnknownStoreVersionError extends Error {}

export interface AppStorePlanOptions {
  /** Lists a platform's editable versions; absent without a configured key. */
  listEditableVersions?: (appId: string, platform: AppStorePlatform) => Promise<AppStoreVersion[]>;
  version?: string;
}

/** The same projection `screenshots upload --json` prints, so the review shows what the CLI reports. */
function appStorePlanView(plan: AppStoreUploadPlan): AppStorePlanView {
  return {
    locales: plan.locales.map((locale) => ({
      ...locale,
      sets: locale.sets.map(({ displayType, upload, replace }) => ({
        displayType,
        upload: upload.map(({ screenId, screenName, sizeId }) => ({ screenId, screenName, sizeId })),
        replace,
      })),
    })),
    skipped: plan.skipped.map(({ entry: { screen, target }, reason }) => ({
      screenId: screen.id, platform: screen.platform, device: screen.device, sizeId: target.id, reason,
    })),
  };
}

/**
 * The CLI's version rule, read before the user confirms: a platform's only editable version is used,
 * and the one `version` string decides where a platform has several.
 */
async function appStoreVersions(
  appId: string,
  platforms: readonly AppStorePlatform[],
  { listEditableVersions, version }: AppStorePlanOptions,
): Promise<Pick<Extract<UploadPlanResponse, { store: "apple" }>, "versions" | "version" | "blocked">> {
  if (!listEditableVersions) return { versions: null, version: null, blocked: null };
  const versions: AppStoreVersionChoice[] = [];
  for (const platform of platforms) {
    // Sorted so a different listing order from App Store Connect does not change the plan hash.
    const editable = (await listEditableVersions(appId, platform)).map(({ versionString, state }) => ({ versionString, state }))
      .sort((a, b) => a.versionString.localeCompare(b.versionString) || a.state.localeCompare(b.state));
    const selected = editable.length === 1 ? editable[0]!.versionString : null;
    versions.push({ platform, editable, selected });
  }
  const empty = versions.filter(({ editable }) => editable.length === 0).map(({ platform }) => platform);
  if (empty.length > 0) {
    return { versions, version: null, blocked: `${empty.join(" and ")} ${empty.length === 1 ? "has" : "have"} no editable version; create one in App Store Connect first` };
  }
  const options = appStoreVersionOptions(versions);
  const ambiguous = versions.filter(({ editable }) => editable.length > 1);
  if (ambiguous.length > 0 && options.length === 0) {
    return {
      versions,
      version: null,
      blocked: `${ambiguous.map(({ platform }) => platform).join(" and ")} have several editable versions with no version string in common; the upload takes one version string for all of them`,
    };
  }
  if (options.length === 0 || version === undefined) return { versions, version: null, blocked: null };
  if (!options.includes(version)) throw new UnknownStoreVersionError(`That version is not an editable version; pick one of ${options.join(", ")}`);
  for (const choice of ambiguous) choice.selected = version;
  return { versions, version, blocked: null };
}

function planHash(fields: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

function planView(plan: GooglePlayUploadPlan): UploadPlanView {
  return {
    locales: plan.locales.map((locale) => ({
      ...locale,
      slots: locale.slots.map(({ imageType, upload, replace }) => ({
        imageType,
        upload: upload.map(({ screenId, screenName, sizeId }) => ({ screenId, screenName, sizeId })),
        replace,
      })),
    })),
    untouchedLocales: plan.untouchedLocales,
    skipped: plan.skipped.map(({ screen, target }) => ({
      screenId: screen.id, platform: screen.platform, device: screen.device, sizeId: target.id,
    })),
  };
}

/**
 * Builds the upload plan from one project snapshot with the CLI's plan module, so the plan, the
 * revision it was built from, and its hash always agree. The hash covers everything the user confirms,
 * for Apple also the editable versions read from App Store Connect and the picked version.
 */
export async function computeUploadPlan(
  projectPath: string,
  projectId: string,
  store: UploadStoreId,
  layout: string | undefined,
  credentialsConfigured: boolean,
  apple: AppStorePlanOptions = {},
): Promise<UploadPlanResponse> {
  const { project, revision } = await readProjectSnapshot(await resolveExistingProjectPath(projectPath));
  const identifier = store === "google" ? project.publishing?.google?.packageName : project.publishing?.apple?.appId;
  if (!identifier) {
    throw new MissingStoreIdentifierError(store === "google"
      ? "This project has no Google Play package name; set it in Stores"
      : "This project has no App Store Connect Apple ID; set it in Stores");
  }
  const layoutId = resolveLayoutReference(project, layout).id;
  assertProjectFontsResolved(project, layoutId);
  const specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
  const base = { identifier, layoutId, revision, credentialsConfigured };
  if (store === "google") {
    const plan = googlePlayUploadPlan(buildBundleEntries(project, layoutId, specs, { platform: "android" }));
    if (plan.entries.length === 0) throw new Error("No screen in this layout has a Google Play screenshot slot");
    validateBundleArtboards(plan.entries, specs);
    const view = planView(plan);
    return {
      ...base,
      store,
      plan: view,
      warnings: bundlePreflightWarnings(plan.entries, specs).map(({ message }) => message),
      planHash: planHash({ store, projectId, revision, layoutId, identifier, plan: view }),
    };
  }
  const plan = appStoreUploadPlan(buildBundleEntries(project, layoutId, specs, { platform: "apple" }), specs);
  if (plan.entries.length === 0) throw new Error("No screen in this layout has an App Store Connect screenshot set");
  validateBundleArtboards(plan.entries, specs);
  const view = appStorePlanView(plan);
  const versions = await appStoreVersions(identifier, plan.platforms, apple);
  return {
    ...base,
    store,
    plan: view,
    ...versions,
    warnings: bundlePreflightWarnings(plan.entries, specs).map(({ message }) => message),
    planHash: planHash({ store, projectId, revision, layoutId, identifier, plan: view, versions: versions.versions, version: versions.version }),
  };
}

/**
 * Plan hashes issued per project, the last few so two tabs reviewing different layouts do not clobber
 * each other. An upload consumes its hash, so one confirmation allows one upload attempt; a replayed or
 * double-clicked confirm needs a fresh plan.
 */
export class UploadPlanRegistry {
  static readonly ISSUED_PER_PROJECT = 8;
  readonly #issued = new Map<string, string[]>();

  issue(projectId: string, planHash: string): void {
    const hashes = (this.#issued.get(projectId) ?? []).filter((issued) => issued !== planHash);
    hashes.push(planHash);
    this.#issued.set(projectId, hashes.slice(-UploadPlanRegistry.ISSUED_PER_PROJECT));
  }

  /** True once for an issued hash, then false. */
  take(projectId: string, planHash: string): boolean {
    const hashes = this.#issued.get(projectId) ?? [];
    const index = hashes.indexOf(planHash);
    if (index < 0) return false;
    hashes.splice(index, 1);
    return true;
  }
}

const processState = globalThis as typeof globalThis & {
  __screenshotStudioUploadPlanRegistry?: UploadPlanRegistry;
};

export const uploadPlanRegistry = processState.__screenshotStudioUploadPlanRegistry ??= new UploadPlanRegistry();
