// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildBundleEntries, parseStoreSpecs, type BundleEntry } from "@screenshot-studio/core/export";
import { resolveLayoutReference } from "@screenshot-studio/core/model";
import { runExportCommand, type ExportCommandDependencies } from "./export-command.js";
import {
  createGooglePlayClient,
  GOOGLE_PLAY_ENDPOINTS,
  GooglePlayRequestError,
  googlePlayAccessToken,
  readGooglePlayServiceAccount,
  type GooglePlayEndpoints,
} from "./google-play-client.js";
import { loadProjectFile, resolveProjectPath } from "./project-io.js";
import {
  googlePlaySlotKey,
  googlePlayUploadPlan,
  skippedFamilies,
  type GooglePlayUploadPlan,
  type RemoteImage,
} from "./store-upload-plan.js";

/** Set by the editor for every agent it spawns; `screenshots upload` refuses to run under it. */
export const AGENT_MARKER_ENV = "SCREENSHOT_STUDIO_AGENT";
export const GOOGLE_PLAY_SERVICE_ACCOUNT_ENV = "GOOGLE_PLAY_SERVICE_ACCOUNT_PATH";

export interface UploadCommandDependencies extends ExportCommandDependencies {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  endpoints?: GooglePlayEndpoints;
  /** Runs once credentials are known to be usable, before rendering (the CLI checks for browsers here). */
  prepareRender?: () => Promise<void>;
}

export function refuseAgentUpload(env: NodeJS.ProcessEnv = process.env): void {
  if (env[AGENT_MARKER_ENV] !== undefined) {
    throw new Error(
      `screenshots upload is a human-only action and does not run in an agent session (${AGENT_MARKER_ENV} is set). Run it yourself in a terminal.`,
    );
  }
}

interface UploadReport {
  store: "google";
  packageName: string;
  layoutId: string;
  dryRun: boolean;
  committed: boolean;
  plan: GooglePlayUploadPlan;
}

function formatReport(report: UploadReport, json: boolean): string {
  const { plan } = report;
  if (json) {
    return JSON.stringify({
      store: report.store,
      packageName: report.packageName,
      layoutId: report.layoutId,
      dryRun: report.dryRun,
      committed: report.committed,
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
    }, null, 2);
  }
  const lines = [`Google Play ${report.packageName} (layout ${report.layoutId})`];
  for (const locale of plan.locales) {
    for (const { imageType, upload, replace } of locale.slots) {
      const replaced = replace === null ? "replaces every current image" : `replaces ${replace.length} current`;
      lines.push(`${locale.locale} ${imageType}: upload ${upload.map(({ screenId }) => screenId).join(", ")} (${replaced})`);
    }
    lines.push(`${locale.locale} untouched: ${locale.untouchedSlots.join(", ")}`);
  }
  lines.push(plan.untouchedLocales === null
    ? "Other store locales are untouched"
    : `Untouched locales: ${plan.untouchedLocales.join(", ") || "(none)"}`);
  if (plan.skipped.length > 0) lines.push(`Skipped, no Google Play slot: ${skippedFamilies(plan.skipped)}`);
  const uploaded = plan.entries.length;
  lines.push(report.dryRun
    ? "Dry run: no edit was created"
    : `Committed one edit with ${uploaded} image${uploaded === 1 ? "" : "s"}`);
  return lines.join("\n");
}

/** Abandons the open edit and rethrows; an uncommitted edit never changes the store listing. */
async function abandon(
  client: ReturnType<typeof createGooglePlayClient>,
  editId: string,
  error: unknown,
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await client.deleteEdit(editId);
  } catch (deleteError) {
    const deleteMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
    throw new Error(
      `${message}\nNothing was committed, so Google Play is unchanged; the open edit could not be deleted (${deleteMessage}) and will expire.`,
      { cause: deleteError },
    );
  }
  throw new Error(`${message}\nThe edit was abandoned; nothing changed on Google Play.`, { cause: error });
}

/**
 * `screenshots upload --store google`: renders the Play slots through the ordinary bundle export, then
 * replaces each touched slot inside one edit and commits it once.
 */
export async function runUploadCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
  dependencies: UploadCommandDependencies = {},
): Promise<string> {
  const env = dependencies.env ?? process.env;
  refuseAgentUpload(env);
  if (flags.store !== "google") {
    throw new Error(flags.store ? `Unsupported store "${flags.store}"; only --store google is available` : "upload requires --store google");
  }
  const projectPath = resolveProjectPath(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const project = await loadProjectFile(projectPath);
  const packageName = project.publishing?.google?.packageName;
  if (!packageName) {
    throw new Error("This project has no Google Play package name; set it with: screenshots publishing set --google-package <name>");
  }
  const layoutId = resolveLayoutReference(project, flags.layout).id;
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const draft = googlePlayUploadPlan(buildBundleEntries(project, layoutId, specs, { platform: "android" }));
  if (draft.entries.length === 0) throw new Error("No selected screen has a Google Play screenshot slot");
  const json = flags.json === "true";
  if (flags["dry-run"] === "true") {
    return formatReport({ store: "google", packageName, layoutId, dryRun: true, committed: false, plan: draft }, json);
  }

  const accountPath = flags["service-account"] ?? env[GOOGLE_PLAY_SERVICE_ACCOUNT_ENV];
  if (!accountPath) {
    throw new Error(`Set ${GOOGLE_PLAY_SERVICE_ACCOUNT_ENV} to the service account JSON key path, or pass --service-account <path>`);
  }
  const account = await readGooglePlayServiceAccount(resolve(accountPath));
  const fetchImpl = dependencies.fetch ?? fetch;
  const endpoints = dependencies.endpoints ?? GOOGLE_PLAY_ENDPOINTS;

  await dependencies.prepareRender?.();
  const renderRoot = await mkdtemp(join(tmpdir(), "screenshots-upload-"));
  try {
    let rendered: BundleEntry[] = [];
    await runExportCommand({ project: projectPath, layout: layoutId, platform: "android", out: renderRoot }, storeSpecsPath, {
      ...dependencies,
      log: () => undefined,
      layoutBundleEntries: (entries) => {
        rendered = entries;
        return googlePlayUploadPlan(entries).entries;
      },
    });
    const local = googlePlayUploadPlan(rendered);
    const pngs = new Map<string, Buffer>();
    for (const entry of local.entries) {
      pngs.set(entry.relativePath, await readFile(join(renderRoot, entry.relativePath)));
    }

    const token = await googlePlayAccessToken(account, { tokenUrl: endpoints.tokenUrl, fetch: fetchImpl });
    const client = createGooglePlayClient({ apiRoot: endpoints.apiRoot, packageName, token, fetch: fetchImpl });
    const editId = await client.insertEdit();
    let plan: GooglePlayUploadPlan;
    try {
      const locales = await client.listListingLanguages(editId);
      const images = new Map<string, RemoteImage[]>();
      for (const locale of local.locales) {
        for (const { imageType } of locale.slots) {
          images.set(googlePlaySlotKey(locale.locale, imageType), await client.listImages(editId, locale.locale, imageType));
        }
      }
      plan = googlePlayUploadPlan(rendered, { locales, images });
      for (const locale of plan.locales) {
        for (const slot of locale.slots) {
          await client.deleteAllImages(editId, locale.locale, slot.imageType);
          for (const image of slot.upload) {
            await client.uploadImage(editId, locale.locale, slot.imageType, pngs.get(image.relativePath)!);
          }
        }
      }
    } catch (error) {
      return await abandon(client, editId, error);
    }
    try {
      await client.commitEdit(editId);
    } catch (error) {
      if (error instanceof GooglePlayRequestError && !error.responded) {
        throw new Error(`${error.message}\nThe commit outcome is unknown; check Play Console before uploading again.`, { cause: error });
      }
      return await abandon(client, editId, error);
    }
    return formatReport({ store: "google", packageName, layoutId, dryRun: false, committed: true, plan }, json);
  } finally {
    await rm(renderRoot, { recursive: true, force: true });
  }
}
