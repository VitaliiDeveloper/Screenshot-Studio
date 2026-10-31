// SPDX-License-Identifier: Apache-2.0
import type { AppStoreDisplayType, BundleEntry } from "@screenshot-studio/core/export";

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

/** Play image types per Android output family; supply uses the same names as folders. */
const GOOGLE_PLAY_SCREENSHOT_TYPES = {
  phone: "phoneScreenshots",
  "tablet-7": "sevenInchScreenshots",
  "tablet-10": "tenInchScreenshots",
  tv: "tvScreenshots",
  wear: "wearScreenshots",
} as const;

export type GooglePlayImageType =
  | (typeof GOOGLE_PLAY_SCREENSHOT_TYPES)[keyof typeof GOOGLE_PLAY_SCREENSHOT_TYPES]
  | "featureGraphic";

const GOOGLE_PLAY_IMAGE_TYPES: readonly GooglePlayImageType[] = [
  ...Object.values(GOOGLE_PLAY_SCREENSHOT_TYPES),
  "featureGraphic",
];

/** Play rejects more than eight screenshots per type and language, and more than one Feature Graphic. */
function googlePlaySlotLimit(imageType: GooglePlayImageType): number {
  return imageType === "featureGraphic" ? 1 : 8;
}

export type Store = "App Store Connect" | "Google Play";

/**
 * Map a project locale to a store locale code: exact match (case-insensitive, `_` read as `-`), then a
 * bare language with exactly one store code, then the explicit defaults. Anything else is an error, so
 * every output segment comes from the allowlist above.
 */
export function storeLocale(locale: string, store: Store): string {
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
  throw new Error(`Locale "${locale}" has no ${store} locale code`);
}

export function appStoreConnectLocale(locale: string): string {
  return storeLocale(locale, "App Store Connect");
}

export function googlePlayLocale(locale: string): string {
  return storeLocale(locale, "Google Play");
}

/**
 * Maps entry locales for a whole bundle: unmapped locales are collected so `assertMapped` lists them
 * all at once, and two project locales that land on one store locale fail immediately.
 */
export function createStoreLocaleMapper() {
  const owners = new Map<string, string>();
  const unmapped = new Set<string>();
  return {
    map(entry: BundleEntry, store: Store): string | undefined {
      let code: string;
      try {
        code = storeLocale(entry.screen.locale, store);
      } catch (error) {
        unmapped.add(error instanceof Error ? error.message : String(error));
        return undefined;
      }
      const ownerKey = `${store}\u0000${code}`;
      const owner = owners.get(ownerKey);
      if (owner !== undefined && owner !== entry.screen.locale) {
        throw new Error(`Locales "${owner}" and "${entry.screen.locale}" both map to ${store} locale "${code}"`);
      }
      owners.set(ownerKey, entry.screen.locale);
      return code;
    },
    assertMapped(): void {
      if (unmapped.size > 0) throw new Error([...unmapped].join("\n"));
    },
  };
}

/** The Play image slot an Android entry fills, or undefined when Play has no slot for its family. */
export function googlePlayImageType(entry: BundleEntry): GooglePlayImageType | undefined {
  if (entry.target.kind === "promotion") return "featureGraphic";
  return Object.hasOwn(GOOGLE_PLAY_SCREENSHOT_TYPES, entry.screen.device)
    ? GOOGLE_PLAY_SCREENSHOT_TYPES[entry.screen.device as keyof typeof GOOGLE_PLAY_SCREENSHOT_TYPES]
    : undefined;
}

/** `windows/desktop (2), web/mobile (1)`: skipped entries counted per output family. */
export function skippedFamilies(skipped: readonly BundleEntry[]): string {
  const counts = new Map<string, number>();
  for (const { screen } of skipped) {
    const key = `${screen.platform}/${screen.device}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => `${key} (${count})`).join(", ");
}

export interface PlannedImage {
  screenId: string;
  screenName: string;
  sizeId: string;
  /** Where the rendered PNG is written, relative to the render folder. */
  relativePath: string;
}

export interface RemoteImage {
  id: string;
}

export interface GooglePlaySlotPlan {
  imageType: GooglePlayImageType;
  /** Uploaded in this order after every current image of the slot is deleted. */
  upload: PlannedImage[];
  /** Current images the upload replaces; null until the store has been read. */
  replace: RemoteImage[] | null;
}

export interface GooglePlayLocalePlan {
  locale: string;
  projectLocale: string;
  slots: GooglePlaySlotPlan[];
  /** Slots of this locale the upload leaves as they are. */
  untouchedSlots: GooglePlayImageType[];
}

export interface GooglePlayUploadPlan {
  locales: GooglePlayLocalePlan[];
  /** Store locales with a listing the upload leaves as they are; null until the store has been read. */
  untouchedLocales: string[] | null;
  /** Entries to render, in upload order, at their plan paths. */
  entries: BundleEntry[];
  /** Entries Google Play has no slot for; they are not rendered. */
  skipped: BundleEntry[];
}

export interface GooglePlayRemoteState {
  /** Languages that have a store listing. */
  locales: readonly string[];
  /** Current images of each touched slot, keyed by `<locale>/<imageType>`. */
  images: ReadonlyMap<string, readonly RemoteImage[]>;
}

export function googlePlaySlotKey(locale: string, imageType: GooglePlayImageType): string {
  return `${locale}/${imageType}`;
}

/**
 * Plan a Google Play screenshot upload: each touched slot is replaced as a whole, in project order;
 * every other slot and locale is left alone. Slot limits are enforced here so an over-full slot never
 * reaches the store.
 */
export function googlePlayUploadPlan(
  entries: readonly BundleEntry[],
  remote?: GooglePlayRemoteState,
): GooglePlayUploadPlan {
  const plan: GooglePlayUploadPlan = { locales: [], untouchedLocales: null, entries: [], skipped: [] };
  const mapper = createStoreLocaleMapper();
  const byLocale = new Map<string, GooglePlayLocalePlan>();

  for (const entry of entries) {
    const imageType = entry.screen.platform === "android" ? googlePlayImageType(entry) : undefined;
    if (!imageType) {
      plan.skipped.push(entry);
      continue;
    }
    const locale = mapper.map(entry, "Google Play");
    if (!locale) continue;
    let localePlan = byLocale.get(locale);
    if (!localePlan) {
      localePlan = { locale, projectLocale: entry.screen.locale, slots: [], untouchedSlots: [] };
      byLocale.set(locale, localePlan);
      plan.locales.push(localePlan);
    }
    let slot = localePlan.slots.find((candidate) => candidate.imageType === imageType);
    if (!slot) {
      const replace = remote ? [...(remote.images.get(googlePlaySlotKey(locale, imageType)) ?? [])] : null;
      slot = { imageType, upload: [], replace };
      localePlan.slots.push(slot);
    }
    const relativePath = `${locale}/${imageType}/${String(slot.upload.length + 1).padStart(2, "0")}.png`;
    slot.upload.push({
      screenId: entry.screen.id,
      screenName: entry.screen.name,
      sizeId: entry.target.id,
      relativePath,
    });
    plan.entries.push({ ...entry, relativePath });
  }
  mapper.assertMapped();

  const overfull = plan.locales.flatMap(({ locale, slots }) => slots
    .filter(({ imageType, upload }) => upload.length > googlePlaySlotLimit(imageType))
    .map(({ imageType, upload }) =>
      `${locale} ${imageType} has ${upload.length} images; Google Play accepts at most ${googlePlaySlotLimit(imageType)}`));
  if (overfull.length > 0) throw new Error(overfull.join("\n"));

  for (const localePlan of plan.locales) {
    localePlan.untouchedSlots = GOOGLE_PLAY_IMAGE_TYPES
      .filter((imageType) => !localePlan.slots.some((slot) => slot.imageType === imageType));
  }
  if (remote) {
    plan.untouchedLocales = remote.locales.filter((locale) => !byLocale.has(locale));
  }
  return plan;
}

/** App Store Connect accepts at most ten screenshots per display type and localization. */
const APP_STORE_SET_LIMIT = 10;

export type AppStorePlatform = "IOS" | "MAC_OS" | "TV_OS" | "VISION_OS";

/** iPhone, iPad and Apple Watch sets belong to the iOS version; these display types to their own platform's. */
const APP_STORE_PLATFORMS: Partial<Record<AppStoreDisplayType, AppStorePlatform>> = {
  APP_DESKTOP: "MAC_OS",
  APP_APPLE_TV: "TV_OS",
  APP_APPLE_VISION_PRO: "VISION_OS",
};

export function appStorePlatform(displayType: AppStoreDisplayType): AppStorePlatform {
  return APP_STORE_PLATFORMS[displayType] ?? "IOS";
}

export interface AppStoreSetPlan {
  displayType: AppStoreDisplayType;
  /** Uploaded in this order after every current screenshot of the set is deleted. */
  upload: PlannedImage[];
  /** Current screenshots the upload replaces; null until the store has been read. */
  replace: RemoteImage[] | null;
}

export interface AppStoreLocalePlan {
  platform: AppStorePlatform;
  locale: string;
  projectLocale: string;
  sets: AppStoreSetPlan[];
}

export interface AppStoreSkippedEntry {
  entry: BundleEntry;
  reason: string;
}

export interface AppStoreUploadPlan {
  /** App Store versions the upload touches, one per platform, in first-use order. */
  platforms: AppStorePlatform[];
  locales: AppStoreLocalePlan[];
  /** Entries to render, in upload order, at their plan paths. */
  entries: BundleEntry[];
  /** Entries App Store Connect has no screenshot set for; they are not rendered. */
  skipped: AppStoreSkippedEntry[];
}

export interface AppStoreRemoteState {
  /** Current screenshots of each touched set, keyed by `appStoreSetKey`; a missing key means no set yet. */
  images: ReadonlyMap<string, readonly RemoteImage[]>;
}

export function appStoreSetKey(platform: AppStorePlatform, locale: string, displayType: AppStoreDisplayType): string {
  return `${platform}/${locale}/${displayType}`;
}

/**
 * Plan an App Store Connect screenshot upload: each touched screenshot set is replaced as a whole, in
 * project order; the display type comes from the catalog target. Set limits and one size per set are
 * enforced here so a set App Store Connect would reject never reaches it.
 */
export function appStoreUploadPlan(
  entries: readonly BundleEntry[],
  remote?: AppStoreRemoteState,
): AppStoreUploadPlan {
  const plan: AppStoreUploadPlan = { platforms: [], locales: [], entries: [], skipped: [] };
  const mapper = createStoreLocaleMapper();
  const byLocale = new Map<string, AppStoreLocalePlan>();
  const sizes = new Map<AppStoreSetPlan, Set<string>>();

  for (const entry of entries) {
    const target = entry.screen.platform === "apple" ? entry.target.appStoreConnect : undefined;
    if (!target || !("displayType" in target)) {
      const reason = entry.screen.platform !== "apple"
        ? "Not an App Store target"
        : target?.unsupported ?? "The store catalog gives this target no App Store Connect display type";
      plan.skipped.push({ entry, reason });
      continue;
    }
    const { displayType } = target;
    const platform = appStorePlatform(displayType);
    const locale = mapper.map(entry, "App Store Connect");
    if (!locale) continue;
    if (!plan.platforms.includes(platform)) plan.platforms.push(platform);
    let localePlan = byLocale.get(`${platform}/${locale}`);
    if (!localePlan) {
      localePlan = { platform, locale, projectLocale: entry.screen.locale, sets: [] };
      byLocale.set(`${platform}/${locale}`, localePlan);
      plan.locales.push(localePlan);
    }
    let set = localePlan.sets.find((candidate) => candidate.displayType === displayType);
    if (!set) {
      const replace = remote ? [...(remote.images.get(appStoreSetKey(platform, locale, displayType)) ?? [])] : null;
      set = { displayType, upload: [], replace };
      localePlan.sets.push(set);
      sizes.set(set, new Set());
    }
    // A rotated twin is the same size; App Store Connect takes both orientations in one set.
    sizes.get(set)!.add([entry.target.width, entry.target.height].sort((a, b) => a - b).join("x"));
    const relativePath = `${locale}/${displayType}/${String(set.upload.length + 1).padStart(2, "0")}.png`;
    set.upload.push({
      screenId: entry.screen.id,
      screenName: entry.screen.name,
      sizeId: entry.target.id,
      relativePath,
    });
    plan.entries.push({ ...entry, relativePath });
  }
  mapper.assertMapped();

  const invalid = plan.locales.flatMap(({ locale, sets }) => sets.flatMap((set) => [
    ...set.upload.length > APP_STORE_SET_LIMIT
      ? [`${locale} ${set.displayType} has ${set.upload.length} screenshots; App Store Connect accepts at most ${APP_STORE_SET_LIMIT}`]
      : [],
    ...sizes.get(set)!.size > 1
      ? [`${locale} ${set.displayType} mixes ${[...sizes.get(set)!].join(" and ")} screenshots; use one size per display type`]
      : [],
  ]));
  if (invalid.length > 0) throw new Error(invalid.join("\n"));
  return plan;
}
