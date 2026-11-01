// SPDX-License-Identifier: Apache-2.0
import {
  safeStoreSizePathToken,
  screenNamePathToken,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { createStoreLocaleMapper, googlePlayImageType, skippedFamilies } from "./store-upload-plan.js";

export { appStoreConnectLocale, googlePlayLocale } from "./store-upload-plan.js";

export interface FastlaneLayout {
  entries: BundleEntry[];
  /** Entries fastlane cannot upload; they are not rendered. */
  skipped: BundleEntry[];
}

/**
 * Rewrite bundle entries into the trees `fastlane deliver` and `supply` read. deliver keeps every
 * device class in one flat locale folder and tells them apart by pixel size, so App Store names carry
 * the device and size to stay unique; supply orders files with a plain string sort, so numbers are
 * zero-padded.
 */
export function fastlaneBundleEntries(entries: readonly BundleEntry[]): FastlaneLayout {
  const result: FastlaneLayout = { entries: [], skipped: [] };
  const counts = new Map<string, number>();
  const mapper = createStoreLocaleMapper();
  const next = (key: string) => {
    const index = (counts.get(key) ?? 0) + 1;
    counts.set(key, index);
    return String(index).padStart(2, "0");
  };

  for (const entry of entries) {
    const { screen, target } = entry;
    if (screen.platform === "apple") {
      const locale = mapper.map(entry, "App Store Connect");
      if (!locale) continue;
      const deviceToken = `${screen.device}-${safeStoreSizePathToken(target.id)}`;
      const name = screenNamePathToken(screen);
      // deliver files 3840x2160 under Vision Pro whenever the path contains "vision", else Apple TV.
      if (screen.device === "tvos" && target.id === "4k" && name.includes("vision")) {
        throw new Error(
          `Apple TV screen "${screen.name}" (${screen.id}) would be read as Vision Pro by fastlane deliver; rename it without "vision"`,
        );
      }
      const number = next(`apple\u0000${locale}\u0000${deviceToken}`);
      result.entries.push({
        ...entry,
        relativePath: `fastlane/screenshots/${locale}/${number}_${name}_${deviceToken}.png`,
      });
      continue;
    }
    if (screen.platform === "android") {
      const imageType = googlePlayImageType(entry);
      if (!imageType) {
        result.skipped.push(entry);
        continue;
      }
      const locale = mapper.map(entry, "Google Play");
      if (!locale) continue;
      const images = `fastlane/metadata/android/${locale}/images`;
      if (imageType === "featureGraphic") {
        if (counts.has(`${images}/featureGraphic`)) {
          throw new Error(`Locale "${screen.locale}" has more than one Google Play Feature Graphic`);
        }
        counts.set(`${images}/featureGraphic`, 1);
        result.entries.push({ ...entry, relativePath: `${images}/featureGraphic.png` });
        continue;
      }
      result.entries.push({ ...entry, relativePath: `${images}/${imageType}/${next(`${images}/${imageType}`)}.png` });
      continue;
    }
    result.skipped.push(entry);
  }

  mapper.assertMapped();
  return result;
}

/** One summary line per skipped output family, e.g. `windows/desktop (2)`. */
export function fastlaneSkippedSummary(skipped: readonly BundleEntry[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const families = skippedFamilies(skipped);
  return `Skipped ${skipped.length} screenshot${skipped.length === 1 ? "" : "s"} fastlane does not upload: ${families}`;
}
