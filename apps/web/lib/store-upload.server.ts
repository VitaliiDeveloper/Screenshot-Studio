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
import { googlePlayUploadPlan, type GooglePlayUploadPlan } from "@screenshot-studio/cli/store-upload-plan";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import type { UploadPlanResponse, UploadPlanView, UploadStoreId } from "./store-upload.js";

/** The project has no store identifier yet; the Stores dialog sets it. */
export class MissingStoreIdentifierError extends Error {}

/** The same projection `screenshots upload --json` prints, so the review shows what the CLI reports. */
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
 * revision it was built from, and its hash always agree. The hash covers everything the user confirms.
 */
export async function computeUploadPlan(
  projectPath: string,
  projectId: string,
  store: UploadStoreId,
  layout: string | undefined,
  credentialsConfigured: boolean,
): Promise<UploadPlanResponse> {
  const { project, revision } = await readProjectSnapshot(await resolveExistingProjectPath(projectPath));
  const identifier = project.publishing?.google?.packageName;
  if (!identifier) throw new MissingStoreIdentifierError("This project has no Google Play package name; set it in Stores");
  const layoutId = resolveLayoutReference(project, layout).id;
  assertProjectFontsResolved(project, layoutId);
  const specs = parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
  const plan = googlePlayUploadPlan(buildBundleEntries(project, layoutId, specs, { platform: "android" }));
  if (plan.entries.length === 0) throw new Error("No screen in this layout has a Google Play screenshot slot");
  validateBundleArtboards(plan.entries, specs);
  const view = planView(plan);
  const planHash = createHash("sha256")
    .update(JSON.stringify({ store, projectId, revision, layoutId, identifier, plan: view }))
    .digest("hex");
  return {
    store,
    identifier,
    layoutId,
    revision,
    plan: view,
    warnings: bundlePreflightWarnings(plan.entries, specs).map(({ message }) => message),
    credentialsConfigured,
    planHash,
  };
}

/**
 * The latest plan hash issued per project. An upload consumes it, so one confirmation allows one
 * upload attempt; a replayed or double-clicked confirm needs a fresh plan.
 */
export class UploadPlanRegistry {
  readonly #issued = new Map<string, string>();

  issue(projectId: string, planHash: string): void {
    this.#issued.set(projectId, planHash);
  }

  take(projectId: string): string | undefined {
    const planHash = this.#issued.get(projectId);
    this.#issued.delete(projectId);
    return planHash;
  }
}

const processState = globalThis as typeof globalThis & {
  __screenshotStudioUploadPlanRegistry?: UploadPlanRegistry;
};

export const uploadPlanRegistry = processState.__screenshotStudioUploadPlanRegistry ??= new UploadPlanRegistry();
