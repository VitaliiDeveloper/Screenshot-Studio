// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildBundleEntries,
  bundlePreflightWarnings,
  leadStoreSizeId,
  parseStoreSpecs,
  parseExportProfile,
  safeLocalePathSegment,
  safeStoreSizePathToken,
  validateBundleArtboards,
  type BundleFilters,
  type StoreSize,
} from "@screenshot-studio/core/export";
import {
  assertProjectFontsResolved,
  getScreen,
  parseScreenPlacement,
  resolveLayoutReference,
  SCREEN_DEVICES_BY_PLATFORM,
  type Screen,
} from "@screenshot-studio/core/model";
import { closeAll, failWhenServerExits, runWithCleanup } from "./cli-runtime.js";
import {
  exportBundle,
  exportScreenToPng,
  resolveTarget,
  withStableProjectExport,
} from "./export.js";
import { loadProjectFile, resolveProjectPath } from "./project-io.js";
import { createRenderBrowserSession } from "./render-driver.js";
import { publishFileSafely } from "./safe-file-publisher.js";
import { startWebServer } from "./server.js";

export type ExportMode =
  | { kind: "single"; screenId: string; sizeId?: string }
  | { kind: "bundle"; filters: BundleFilters };

export interface ExportCommandDependencies {
  startWebServer?: typeof startWebServer;
  exportScreenToPng?: typeof exportScreenToPng;
  exportBundle?: typeof exportBundle;
  createRenderBrowserSession?: typeof createRenderBrowserSession;
  publishFileSafely?: typeof publishFileSafely;
  log?: (message: string) => void;
}

const SUPPORTED_DEVICES = new Set<string>(Object.values(SCREEN_DEVICES_BY_PLATFORM).flat());

function isSupportedPlatform(value: string): value is Screen["platform"] {
  return Object.hasOwn(SCREEN_DEVICES_BY_PLATFORM, value);
}

function isSupportedDevice(value: string): value is Screen["device"] {
  return SUPPORTED_DEVICES.has(value);
}

export function resolveExportMode(flags: Record<string, string>): ExportMode {
  const hasBundleFilter = Boolean(flags.platform || flags.device || flags.locale);
  if (flags.screen && hasBundleFilter) {
    throw new Error("--screen cannot be combined with --platform, --device, or --locale");
  }
  if (flags.size && !flags.screen) {
    throw new Error("--size requires --screen; bundle exports use each device's lead size");
  }
  if (flags.screen) {
    return { kind: "single", screenId: flags.screen, sizeId: flags.size };
  }

  let platform: Screen["platform"] | undefined;
  if (flags.platform) {
    if (!isSupportedPlatform(flags.platform)) {
      throw new Error(`Unsupported platform filter: ${flags.platform}`);
    }
    platform = flags.platform;
  }

  let device: Screen["device"] | undefined;
  if (flags.device) {
    if (!isSupportedDevice(flags.device)) {
      throw new Error(`Unsupported device filter: ${flags.device}`);
    }
    device = flags.device;
  }
  if (platform && device && !parseScreenPlacement(platform, device)) {
    throw new Error(`Unsupported platform/device filter pair: ${platform}/${device}`);
  }
  return { kind: "bundle", filters: { platform, device, locale: flags.locale } };
}

export function singleExportFilename(
  screen: Pick<Screen, "platform" | "device" | "locale">,
  target: Pick<StoreSize, "id">,
): string {
  const targetToken = safeStoreSizePathToken(target.id);
  const filename = `${screen.platform}-${screen.device}-${targetToken}-${safeLocalePathSegment(screen.locale)}.png`;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("\0")) {
    throw new Error(`Unsafe single export filename "${filename}"`);
  }
  return filename;
}

export function singleExportTargetId(
  screen: Pick<Screen, "platform" | "device" | "storeTargetId">,
  explicitSizeId?: string,
): string {
  return explicitSizeId ?? screen.storeTargetId ?? leadStoreSizeId(screen.platform, screen.device);
}

export async function runExportCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
  dependencies: ExportCommandDependencies = {},
): Promise<void> {
  const startServer = dependencies.startWebServer ?? startWebServer;
  const exportScreen = dependencies.exportScreenToPng ?? exportScreenToPng;
  const exportBundleOutputs = dependencies.exportBundle ?? exportBundle;
  const createRenderSession = dependencies.createRenderBrowserSession ?? createRenderBrowserSession;
  const publishFile = dependencies.publishFileSafely ?? publishFileSafely;
  const log = dependencies.log ?? console.log;
  const projectPath = resolveProjectPath(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const explicitOutDir = flags.out ? resolve(flags.out) : undefined;
  const mode = resolveExportMode(flags);
  const profile = parseExportProfile(flags.profile);
  if (profile === "web-share" && mode.kind === "single") {
    throw new Error("--profile web-share requires a bundle export, not --screen");
  }
  const layoutId = resolveLayoutReference(await loadProjectFile(projectPath), flags.layout).id;

  if (mode.kind === "single") {
    const server = await startServer(undefined, { storeSpecsPath });
    await runWithCleanup(async () => {
      await withStableProjectExport(projectPath, async (context) => {
        resolveLayoutReference(context.project, layoutId);
        assertProjectFontsResolved(context.project, layoutId);
        const screen = getScreen(context.project, layoutId, mode.screenId);
        const target = await resolveTarget(
          storeSpecsPath,
          screen.platform,
          screen.device,
          singleExportTargetId(screen, mode.sizeId),
        );
        const outDir = explicitOutDir ?? join(dirname(context.projectPath), "export");
        const relativePath = singleExportFilename(screen, target);
        const png = await failWhenServerExits(server, exportScreen({
          baseUrl: server.url,
          projectPath: context.projectPath,
          projectRevision: context.revision,
          layoutId,
          screenId: mode.screenId,
          target,
        }));
        const publication = await context.publish(() => publishFile({
          root: outDir,
          relativePath,
          bytes: png,
          replace: true,
        }));
        log(`Exported ${publication.path} (${target.width}x${target.height})`);
      });
    }, () => server.stop());
    return;
  }

  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const server = await startServer(undefined, { storeSpecsPath });
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  await runWithCleanup(async () => {
    session = await createRenderSession();
    await withStableProjectExport(projectPath, async (context) => {
      resolveLayoutReference(context.project, layoutId);
      assertProjectFontsResolved(context.project, layoutId);
      const entries = buildBundleEntries(context.project, layoutId, specs, mode.filters);
      validateBundleArtboards(entries);
      for (const warning of bundlePreflightWarnings(entries)) log(`Warning: ${warning.message}`);
      const outDir = explicitOutDir ?? join(dirname(context.projectPath), "export");
      const zipPath = await failWhenServerExits(server, exportBundleOutputs({
        baseUrl: server.url,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId,
        outDir,
        entries,
        renderSession: session!,
        publicationGuard: context.publish,
        profile,
        project: context.project,
      }));
      log(`Exported ${entries.length} screenshots to ${outDir}`);
      log(`Wrote bundle ${zipPath}`);
    });
  }, () => closeAll([
    ...(session ? [() => session!.close()] : []),
    () => server.stop(),
  ]));
}
