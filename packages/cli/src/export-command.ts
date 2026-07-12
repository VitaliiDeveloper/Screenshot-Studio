// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildBundleEntries,
  leadStoreSizeId,
  parseStoreSpecs,
  safeLocalePathSegment,
  safeStoreSizePathToken,
  type BundleFilters,
  type StoreSize,
} from "@screenshot-studio/core/export";
import {
  assertProjectFontsResolved,
  getScreen,
  parseProjectJson,
  parseScreenPlacement,
  SCREEN_DEVICES_BY_PLATFORM,
  type Screen,
} from "@screenshot-studio/core/model";
import { closeAll, failWhenServerExits, runWithCleanup } from "./cli-runtime.js";
import { exportBundle, exportScreenToPng, resolveTarget } from "./export.js";
import { createRenderBrowserSession } from "./render-driver.js";
import { startWebServer } from "./server.js";

export type ExportMode =
  | { kind: "single"; screenId: string; sizeId?: string }
  | { kind: "bundle"; filters: BundleFilters };

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
): Promise<void> {
  const projectPath = resolve(flags.project ?? "app-store-screenshots.json");
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const outDir = flags.out ? resolve(flags.out) : join(dirname(projectPath), "export");
  const mode = resolveExportMode(flags);

  const project = parseProjectJson(await readFile(projectPath, "utf8"));
  assertProjectFontsResolved(project);

  if (mode.kind === "single") {
    const screen = getScreen(project, mode.screenId);
    const target = await resolveTarget(
      storeSpecsPath,
      screen.platform,
      screen.device,
      singleExportTargetId(screen, mode.sizeId),
    );
    const outFile = join(outDir, singleExportFilename(screen, target));

    const server = await startWebServer(undefined, { storeSpecsPath });
    await runWithCleanup(async () => {
      const png = await failWhenServerExits(server, exportScreenToPng({
        baseUrl: server.url,
        projectPath,
        screenId: mode.screenId,
        target,
      }));
      await mkdir(outDir, { recursive: true });
      await writeFile(outFile, png);
      console.log(`Exported ${outFile} (${target.width}x${target.height})`);
    }, () => server.stop());
    return;
  }

  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const entries = buildBundleEntries(project, specs, mode.filters);
  const server = await startWebServer(undefined, { storeSpecsPath });
  let session: Awaited<ReturnType<typeof createRenderBrowserSession>> | undefined;
  await runWithCleanup(async () => {
    session = await createRenderBrowserSession();
    const zipPath = await failWhenServerExits(server, exportBundle({
      baseUrl: server.url,
      projectPath,
      outDir,
      entries,
      renderSession: session,
    }));
    console.log(`Exported ${entries.length} screenshots to ${outDir}`);
    console.log(`Wrote bundle ${zipPath}`);
  }, () => closeAll([
    ...(session ? [() => session!.close()] : []),
    () => server.stop(),
  ]));
}
