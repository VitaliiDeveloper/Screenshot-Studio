// SPDX-License-Identifier: Apache-2.0
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  listStoreTargets,
  safeStoreSizePathToken,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { SCREEN_DEVICES_BY_PLATFORM } from "@screenshot-studio/core/model";
import { hasCode } from "./safe-file/fs-basics.js";
import { removeRegularFileSafely } from "./safe-file-publisher.js";
import { GOOGLE_PLAY_SCREENSHOT_TYPES, storeLocale, type Store } from "./store-upload-plan.js";

const SLOT_NUMBER = "(?:0[1-9]|[1-9][0-9]+)";
const APP_STORE_NAME = new RegExp(`^${SLOT_NUMBER}_[a-z0-9-]+_(.+)\\.png$`);
const PLAY_SCREENSHOT_NAME = new RegExp(`^${SLOT_NUMBER}\\.png$`);
const FEATURE_GRAPHIC_NAME = "featureGraphic.png";
// deliver and supply also upload JPEGs, and their globs skip dotfiles.
const SCREENSHOT_UPLOAD_NAME = /^[^.].*\.(?:png|jpe?g)$/i;

interface ManagedFolder {
  path: string;
  isGenerated(name: string): boolean;
  isUploaded(name: string): boolean;
}

async function listEntries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return [];
    throw error;
  }
}

function isStoreLocaleFolder(name: string, store: Store): boolean {
  try {
    return storeLocale(name, store) === name;
  } catch {
    return false;
  }
}

async function localeFolders(outDir: string, parent: string, store: Store): Promise<string[]> {
  const entries = await listEntries(join(outDir, parent));
  return entries
    .filter((entry) => entry.isDirectory() && isStoreLocaleFolder(entry.name, store))
    .map((entry) => entry.name);
}

/** The folders of every store locale on disk, so a locale removed from the project is covered too. */
async function managedFolders(outDir: string, specs: StoreSpecs): Promise<ManagedFolder[]> {
  const deviceTokens = new Set(SCREEN_DEVICES_BY_PLATFORM.apple.flatMap((device) => (
    listStoreTargets(specs, "apple", device).map(({ id }) => `${device}-${safeStoreSizePathToken(id)}`)
  )));
  const isScreenshotUpload = (name: string) => SCREENSHOT_UPLOAD_NAME.test(name);
  const isFeatureGraphic = (name: string) => name === FEATURE_GRAPHIC_NAME;

  const appStore = await localeFolders(outDir, "fastlane/screenshots", "App Store Connect");
  const googlePlay = await localeFolders(outDir, "fastlane/metadata/android", "Google Play");
  return [
    ...appStore.map((locale) => ({
      path: `fastlane/screenshots/${locale}`,
      isGenerated: (name: string) => deviceTokens.has(APP_STORE_NAME.exec(name)?.[1] ?? ""),
      isUploaded: isScreenshotUpload,
    })),
    ...googlePlay.flatMap((locale) => {
      const images = `fastlane/metadata/android/${locale}/images`;
      return [
        // Other images here (icon.png, tvBanner.png) are the user's own listing inputs.
        { path: images, isGenerated: isFeatureGraphic, isUploaded: isFeatureGraphic },
        ...Object.values(GOOGLE_PLAY_SCREENSHOT_TYPES).map((imageType) => ({
          path: `${images}/${imageType}`,
          isGenerated: (name: string) => PLAY_SCREENSHOT_NAME.test(name),
          isUploaded: isScreenshotUpload,
        })),
      ];
    }),
  ];
}

/**
 * Removes generated store images a complete fastlane export no longer produces, because deliver and
 * supply upload everything they find. Call it only after that export has been published.
 */
export async function pruneStaleFastlaneFiles({ outDir, published, specs, log }: {
  outDir: string;
  published: readonly string[];
  specs: StoreSpecs;
  log: (message: string) => void;
}): Promise<void> {
  // Same key the publisher uses: on a case-insensitive filesystem these names are one published file.
  const pathKey = (path: string) => path.normalize("NFC").toLowerCase();
  const current = new Set(published.map(pathKey));

  for (const folder of await managedFolders(outDir, specs)) {
    for (const entry of await listEntries(join(outDir, folder.path))) {
      const relativePath = `${folder.path}/${entry.name}`;
      if (current.has(pathKey(relativePath)) || !folder.isUploaded(entry.name)) continue;
      const path = join(outDir, relativePath);
      if (!entry.isFile() || !folder.isGenerated(entry.name)) {
        log(`Warning: kept ${path} because the export did not generate it; fastlane would upload it`);
      } else if (await removeRegularFileSafely(outDir, relativePath)) {
        log(`Removed stale ${path}`);
      }
    }
  }
}
