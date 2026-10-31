// SPDX-License-Identifier: Apache-2.0
import { safeStoreSizePathToken, type BundleEntry } from "@screenshot-studio/core/export";

// fastlane 2.241: FastlaneCore::Languages::ALL_LANGUAGES (deliver language folders).
const APP_STORE_LOCALES = [
  "ar-SA", "bn-BD", "ca", "cs", "da", "de-DE", "el", "en-AU", "en-CA", "en-GB", "en-US", "es-ES",
  "es-MX", "fi", "fr-CA", "fr-FR", "gu-IN", "he", "hi", "hr", "hu", "id", "it", "ja", "kn-IN", "ko",
  "ml-IN", "mr-IN", "ms", "nl-NL", "no", "or-IN", "pa-IN", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk",
  "sl-SI", "sv", "ta-IN", "te-IN", "th", "tr", "uk", "ur-PK", "vi", "zh-Hans", "zh-Hant",
];

// fastlane 2.241: Supply::Languages::ALL_LANGUAGES, in the hyphenated form the Play API expects.
const GOOGLE_PLAY_LOCALES = [
  "af", "am", "ar", "az-AZ", "be", "bg", "bn-BD", "ca", "cs-CZ", "da-DK", "de-DE", "el-GR", "en-AU",
  "en-CA", "en-GB", "en-IN", "en-SG", "en-US", "en-ZA", "es-419", "es-ES", "es-US", "et", "eu-ES",
  "fa", "fi-FI", "fil", "fr-CA", "fr-FR", "gl-ES", "hi-IN", "hr", "hu-HU", "hy-AM", "id", "is-IS",
  "it-IT", "iw-IL", "ja-JP", "ka-GE", "km-KH", "kn-IN", "ko-KR", "ky-KG", "lo-LA", "lt", "lv",
  "mk-MK", "ml-IN", "mn-MN", "mr-IN", "ms", "ms-MY", "my-MM", "ne-NP", "nl-NL", "no-NO", "pl-PL",
  "pt-BR", "pt-PT", "rm", "ro", "ru-RU", "si-LK", "sk", "sl", "sr", "sv-SE", "sw", "ta-IN", "te-IN",
  "th", "tr-TR", "uk", "vi", "zh-CN", "zh-HK", "zh-TW", "zu",
];

/** Bare language codes whose store has several regional folders and one conventional default. */
const APP_STORE_LANGUAGE_DEFAULTS: Record<string, string> = { en: "en-US", es: "es-ES", fr: "fr-FR" };
const GOOGLE_PLAY_LANGUAGE_DEFAULTS: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", he: "iw-IL",
};

/** supply image slots per Android output family; other families have no Play upload slot. */
const SUPPLY_SCREENSHOT_FOLDERS: Record<string, string> = {
  phone: "phoneScreenshots",
  "tablet-7": "sevenInchScreenshots",
  "tablet-10": "tenInchScreenshots",
  tv: "tvScreenshots",
  wear: "wearScreenshots",
};

type Store = "App Store Connect" | "Google Play";

/**
 * Map a project locale to a store folder code: exact match (case-insensitive, `_` read as `-`), then a
 * bare language with exactly one store code, then the explicit defaults. Anything else is an error, so
 * every output segment comes from the allowlist above.
 */
function storeLocale(locale: string, store: Store): string {
  const codes = store === "App Store Connect" ? APP_STORE_LOCALES : GOOGLE_PLAY_LOCALES;
  const defaults = store === "App Store Connect" ? APP_STORE_LANGUAGE_DEFAULTS : GOOGLE_PLAY_LANGUAGE_DEFAULTS;
  const wanted = locale.replace(/_/g, "-").toLowerCase();
  const exact = codes.find((code) => code.toLowerCase() === wanted);
  if (exact) return exact;
  if (/^[a-z]{2,3}$/.test(wanted)) {
    const candidates = codes.filter((code) => code.toLowerCase().startsWith(`${wanted}-`));
    if (candidates.length === 1) return candidates[0]!;
    if (Object.hasOwn(defaults, wanted)) return defaults[wanted]!;
    if (candidates.length > 1) {
      throw new Error(
        `Locale "${locale}" matches several ${store} locales (${candidates.join(", ")}); rename it to one of them`,
      );
    }
  }
  throw new Error(`Locale "${locale}" has no ${store} locale code for the fastlane layout`);
}

export function appStoreConnectLocale(locale: string): string {
  return storeLocale(locale, "App Store Connect");
}

export function googlePlayLocale(locale: string): string {
  return storeLocale(locale, "Google Play");
}

export interface FastlaneLayout {
  entries: BundleEntry[];
  /** Entries fastlane cannot upload; they are not rendered. */
  skipped: BundleEntry[];
}

function screenToken(entry: BundleEntry): string {
  const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (sanitize(entry.screen.name) || sanitize(entry.screen.id) || "screen").slice(0, 96);
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
  const localeOwners = new Map<string, string>();
  const unmapped = new Set<string>();
  const next = (key: string) => {
    const index = (counts.get(key) ?? 0) + 1;
    counts.set(key, index);
    return String(index).padStart(2, "0");
  };
  const mapLocale = (entry: BundleEntry, store: Store): string | undefined => {
    let code: string;
    try {
      code = storeLocale(entry.screen.locale, store);
    } catch (error) {
      unmapped.add(error instanceof Error ? error.message : String(error));
      return undefined;
    }
    const ownerKey = `${store}\u0000${code}`;
    const owner = localeOwners.get(ownerKey);
    if (owner !== undefined && owner !== entry.screen.locale) {
      throw new Error(`Locales "${owner}" and "${entry.screen.locale}" both map to ${store} locale "${code}"`);
    }
    localeOwners.set(ownerKey, entry.screen.locale);
    return code;
  };

  for (const entry of entries) {
    const { screen, target } = entry;
    if (screen.platform === "apple") {
      const locale = mapLocale(entry, "App Store Connect");
      if (!locale) continue;
      const deviceToken = `${screen.device}-${safeStoreSizePathToken(target.id)}`;
      const name = screenToken(entry);
      // deliver files 3840x2160 under Vision Pro whenever the path contains "vision", else Apple TV.
      if (screen.device === "tvos" && name.includes("vision")) {
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
      const isFeatureGraphic = target.kind === "promotion";
      const folder = SUPPLY_SCREENSHOT_FOLDERS[screen.device];
      if (!isFeatureGraphic && !folder) {
        result.skipped.push(entry);
        continue;
      }
      const locale = mapLocale(entry, "Google Play");
      if (!locale) continue;
      const images = `fastlane/metadata/android/${locale}/images`;
      if (isFeatureGraphic) {
        if (counts.has(`${images}/featureGraphic`)) {
          throw new Error(`Locale "${screen.locale}" has more than one Google Play Feature Graphic`);
        }
        counts.set(`${images}/featureGraphic`, 1);
        result.entries.push({ ...entry, relativePath: `${images}/featureGraphic.png` });
        continue;
      }
      result.entries.push({ ...entry, relativePath: `${images}/${folder}/${next(`${images}/${folder}`)}.png` });
      continue;
    }
    result.skipped.push(entry);
  }

  if (unmapped.size > 0) throw new Error([...unmapped].join("\n"));
  return result;
}

/** One summary line per skipped output family, e.g. `windows/desktop (2)`. */
export function fastlaneSkippedSummary(skipped: readonly BundleEntry[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const { screen } of skipped) {
    const key = `${screen.platform}/${screen.device}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const families = [...counts].map(([key, count]) => `${key} (${count})`).join(", ");
  return `Skipped ${skipped.length} screenshot${skipped.length === 1 ? "" : "s"} fastlane does not upload: ${families}`;
}
