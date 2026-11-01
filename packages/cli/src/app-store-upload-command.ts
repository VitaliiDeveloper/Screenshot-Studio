// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildBundleEntries,
  bundlePreflightWarnings,
  parseStoreSpecs,
  validateBundleArtboards,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { resolveLayoutReference } from "@screenshot-studio/core/model";
import {
  APP_STORE_CONNECT_API_ROOT,
  AppStoreConnectRequestError,
  createAppStoreConnectClient,
  readAppStoreConnectKey,
  type AppStoreVersion,
} from "./app-store-connect-client.js";
import { runExportCommand } from "./export-command.js";
import { loadProjectFile, resolveProjectPath } from "./project-io.js";
import {
  appStoreSetKey,
  appStoreUploadPlan,
  type AppStorePlatform,
  type AppStoreSetPlan,
  type AppStoreUploadPlan,
  type RemoteImage,
} from "./store-upload-plan.js";
import { refuseAgentUpload, type UploadCommandDependencies } from "./upload-command.js";

export const APP_STORE_CONNECT_KEY_ID_ENV = "APP_STORE_CONNECT_KEY_ID";
export const APP_STORE_CONNECT_ISSUER_ID_ENV = "APP_STORE_CONNECT_ISSUER_ID";
export const APP_STORE_CONNECT_KEY_PATH_ENV = "APP_STORE_CONNECT_KEY_PATH";

export interface AppStoreUploadDependencies extends Omit<UploadCommandDependencies, "endpoints"> {
  apiRoot?: string;
  now?: () => number;
  pollIntervalMs?: number;
  processingTimeoutMs?: number;
}

/** untouched: nothing sent; replaced: every old screenshot deleted and every new one processed. */
export type AppStoreSetState = "untouched" | "replaced" | "partial" | "failed";

interface SetOutcome {
  state: AppStoreSetState;
  error?: string;
}

interface AppStoreReport {
  appId: string;
  layoutId: string;
  dryRun: boolean;
  versions: Array<{ platform: AppStorePlatform; versionString: string; state: string }>;
  plan: AppStoreUploadPlan;
  outcomes: Map<AppStoreSetPlan, SetOutcome>;
}

function formatReport(report: AppStoreReport, json: boolean): string {
  const { plan, outcomes } = report;
  if (json) {
    return JSON.stringify({
      store: "apple",
      appId: report.appId,
      layoutId: report.layoutId,
      dryRun: report.dryRun,
      versions: report.versions,
      locales: plan.locales.map((locale) => ({
        ...locale,
        sets: locale.sets.map((set) => ({
          displayType: set.displayType,
          upload: set.upload.map(({ screenId, screenName, sizeId }) => ({ screenId, screenName, sizeId })),
          replace: set.replace,
          ...outcomes.get(set),
        })),
      })),
      skipped: plan.skipped.map(({ entry: { screen, target }, reason }) => ({
        screenId: screen.id, platform: screen.platform, device: screen.device, sizeId: target.id, reason,
      })),
    }, null, 2);
  }
  const lines = [`App Store Connect app ${report.appId} (layout ${report.layoutId})`];
  for (const { platform, versionString, state } of report.versions) lines.push(`${platform} version ${versionString} (${state})`);
  for (const locale of plan.locales) {
    for (const set of locale.sets) {
      const replaced = set.replace === null ? "replaces every current screenshot" : `replaces ${set.replace.length} current`;
      const outcome = outcomes.get(set);
      const state = outcome ? `: ${outcome.state}${outcome.error ? ` (${outcome.error})` : ""}` : "";
      lines.push(`${locale.platform} ${locale.locale} ${set.displayType}: upload ${set.upload.map(({ screenId }) => screenId).join(", ")} (${replaced})${state}`);
    }
  }
  const skipped = new Map<string, number>();
  for (const { entry: { screen, target }, reason } of plan.skipped) {
    const key = `${screen.platform}/${screen.device} ${target.id}: ${reason}`;
    skipped.set(key, (skipped.get(key) ?? 0) + 1);
  }
  for (const [key, count] of skipped) lines.push(`Skipped ${count}, ${key}`);
  if (report.dryRun) {
    lines.push("Dry run: App Store Connect was not contacted");
  } else {
    const sets = [...outcomes.values()];
    const replaced = sets.filter(({ state }) => state === "replaced").length;
    lines.push(`Replaced ${replaced} of ${sets.length} screenshot set${sets.length === 1 ? "" : "s"}`);
  }
  return lines.join("\n");
}

/** The only editable version of a platform; `--version` picks one only where there are several. */
function selectVersion(platform: AppStorePlatform, versions: AppStoreVersion[], wanted: string | undefined): AppStoreVersion | string {
  if (versions.length === 0) return `${platform} has no editable version; create one in App Store Connect first`;
  if (versions.length === 1) return versions[0]!;
  const listed = versions.map(({ versionString, state }) => `${versionString} (${state})`).join(", ");
  if (wanted === undefined) return `${platform} has several editable versions: ${listed}; pass --version <string>`;
  return versions.find(({ versionString }) => versionString === wanted)
    ?? `${platform} has no editable version ${wanted}; editable: ${listed}`;
}

/**
 * `screenshots upload --store apple`: renders the App Store sets through the ordinary bundle export,
 * then replaces each touched screenshot set in turn. App Store Connect has no atomic commit, so each
 * set's outcome is reported and any set short of replaced makes the exit code non-zero.
 */
export async function runAppStoreUploadCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
  dependencies: AppStoreUploadDependencies = {},
): Promise<{ output: string; exitCode: 0 | 1 }> {
  const env = dependencies.env ?? process.env;
  refuseAgentUpload(env);
  const projectPath = resolveProjectPath(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const project = await loadProjectFile(projectPath);
  const appId = project.publishing?.apple?.appId;
  if (!appId) {
    throw new Error("This project has no App Store Connect app id; set it with: screenshots publishing set --apple-app-id <id>");
  }
  const layoutId = resolveLayoutReference(project, flags.layout).id;
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const draft = appStoreUploadPlan(buildBundleEntries(project, layoutId, specs, { platform: "apple" }), specs);
  if (draft.entries.length === 0) throw new Error("No selected screen has an App Store Connect screenshot set");
  validateBundleArtboards(draft.entries, specs);
  const warn = dependencies.warn ?? console.error;
  for (const warning of bundlePreflightWarnings(draft.entries, specs)) warn(`Warning: ${warning.message}`);
  const json = flags.json === "true";
  if (flags["dry-run"] === "true") {
    return {
      output: formatReport({ appId, layoutId, dryRun: true, versions: [], plan: draft, outcomes: new Map() }, json),
      exitCode: 0,
    };
  }

  const keyId = env[APP_STORE_CONNECT_KEY_ID_ENV];
  const issuerId = env[APP_STORE_CONNECT_ISSUER_ID_ENV];
  const keyPath = flags["key-path"] ?? env[APP_STORE_CONNECT_KEY_PATH_ENV];
  if (!keyId || !issuerId || !keyPath) {
    throw new Error(
      `Set ${APP_STORE_CONNECT_KEY_ID_ENV}, ${APP_STORE_CONNECT_ISSUER_ID_ENV} and ${APP_STORE_CONNECT_KEY_PATH_ENV} (or pass --key-path <path>) for an App Store Connect API key`,
    );
  }
  const client = createAppStoreConnectClient({
    apiRoot: dependencies.apiRoot ?? APP_STORE_CONNECT_API_ROOT,
    key: await readAppStoreConnectKey(resolve(keyPath), keyId, issuerId),
    fetch: dependencies.fetch ?? fetch,
    timeoutMs: dependencies.requestTimeoutMs,
    now: dependencies.now,
    pollIntervalMs: dependencies.pollIntervalMs,
    processingTimeoutMs: dependencies.processingTimeoutMs,
  });

  // Read before rendering: the first call proves the key works, and a wrong version or a missing
  // localization stops the upload before anything is rendered or changed.
  const versions = new Map<AppStorePlatform, AppStoreVersion>();
  const problems: string[] = [];
  for (const platform of draft.platforms) {
    const selected = selectVersion(platform, await client.listEditableVersions(appId, platform), flags.version);
    if (typeof selected === "string") problems.push(selected);
    else versions.set(platform, selected);
  }
  if (problems.length > 0) throw new Error(`${problems.join("\n")}\nNothing was changed on App Store Connect.`);
  const localizations = new Map<string, string>();
  for (const [platform, version] of versions) {
    for (const { id, locale } of await client.listLocalizations(version.id)) localizations.set(`${platform}/${locale}`, id);
  }
  const missing = draft.locales
    .filter(({ platform, locale }) => !localizations.has(`${platform}/${locale}`))
    .map(({ platform, locale }) => `${locale} (${platform} ${versions.get(platform)!.versionString})`);
  if (missing.length > 0) {
    throw new Error(`App Store Connect has no localization for ${missing.join(", ")}; add the language in App Store Connect first\nNothing was changed on App Store Connect.`);
  }

  await dependencies.prepareRender?.();
  const renderRoot = await mkdtemp(join(tmpdir(), "screenshots-upload-"));
  try {
    let rendered: BundleEntry[] = [];
    await runExportCommand({ project: projectPath, layout: layoutId, platform: "apple", out: renderRoot }, storeSpecsPath, {
      ...dependencies,
      log: () => undefined,
      layoutBundleEntries: (entries) => {
        rendered = entries;
        return appStoreUploadPlan(entries, specs).entries;
      },
    });
    const local = appStoreUploadPlan(rendered, specs);
    const pngs = new Map<string, Buffer>();
    for (const entry of local.entries) {
      pngs.set(entry.relativePath, await readFile(join(renderRoot, entry.relativePath)));
    }

    const setIds = new Map<string, string>();
    const images = new Map<string, RemoteImage[]>();
    for (const { platform, locale, sets } of local.locales) {
      const existing = await client.listScreenshotSets(localizations.get(`${platform}/${locale}`)!);
      for (const { displayType } of sets) {
        const set = existing.find((candidate) => candidate.displayType === displayType);
        if (!set) continue;
        const key = appStoreSetKey(platform, locale, displayType);
        setIds.set(key, set.id);
        images.set(key, await client.listScreenshots(set.id));
      }
    }
    const plan = appStoreUploadPlan(rendered, specs, { images });
    const outcomes = new Map<AppStoreSetPlan, SetOutcome>();
    for (const { sets } of plan.locales) for (const set of sets) outcomes.set(set, { state: "untouched" });

    let stopped = false;
    for (const { platform, locale, sets } of plan.locales) {
      for (const set of sets) {
        if (stopped) continue;
        let changed = false;
        try {
          const key = appStoreSetKey(platform, locale, set.displayType);
          let setId = setIds.get(key);
          if (!setId) {
            setId = await client.createScreenshotSet(localizations.get(`${platform}/${locale}`)!, set.displayType);
            changed = true;
          }
          for (const { id } of set.replace ?? []) {
            await client.deleteScreenshot(id);
            changed = true;
          }
          const uploaded: string[] = [];
          for (const [index, image] of set.upload.entries()) {
            changed = true;
            uploaded.push(await client.uploadScreenshot(setId, `${String(index + 1).padStart(2, "0")}.png`, pngs.get(image.relativePath)!));
          }
          for (const id of uploaded) await client.waitForProcessing(id);
          outcomes.set(set, { state: "replaced" });
        } catch (error) {
          // Without a response the change may have landed, so the set is no longer known to be as it was.
          const unknown = error instanceof AppStoreConnectRequestError && !error.responded;
          outcomes.set(set, {
            state: changed || unknown ? "partial" : "failed",
            error: error instanceof Error ? error.message : String(error),
          });
          stopped = true;
        }
      }
    }
    const report: AppStoreReport = {
      appId,
      layoutId,
      dryRun: false,
      versions: [...versions].map(([platform, { versionString, state }]) => ({ platform, versionString, state })),
      plan,
      outcomes,
    };
    return { output: formatReport(report, json), exitCode: stopped ? 1 : 0 };
  } finally {
    await rm(renderRoot, { recursive: true, force: true });
  }
}
