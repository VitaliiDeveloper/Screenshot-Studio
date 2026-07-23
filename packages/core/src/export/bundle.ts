// SPDX-License-Identifier: Apache-2.0
import {
  getLayout,
  OUTPUT_DEVICE_FAMILIES,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import { findStoreTarget, type StoreSize, type StoreSpecs } from "./specs.js";
import { exportPixelRatio } from "./pixel-ratio.js";

export interface BundleFilters {
  platform?: Screen["platform"];
  device?: Screen["device"];
  locale?: string;
}

export interface BundleEntry {
  screen: Screen;
  target: StoreSize;
  relativePath: string;
}

export interface BundlePreflightWarning {
  code: "android-tablet-screen-count";
  platform: "android";
  device: "tablet-7" | "tablet-10";
  locale: string;
  screenCount: number;
  message: string;
}

/** Advisory listing guidance; rendering/export remains valid below the recommendation. */
export function bundlePreflightWarnings(entries: readonly BundleEntry[]): BundlePreflightWarning[] {
  const counts = new Map<string, { device: "tablet-7" | "tablet-10"; locale: string; count: number }>();
  for (const { screen } of entries) {
    if (screen.platform !== "android" || (screen.device !== "tablet-7" && screen.device !== "tablet-10")) continue;
    const key = `${screen.device}\u0000${screen.locale}`;
    const current = counts.get(key) ?? { device: screen.device, locale: screen.locale, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()]
    .filter(({ count }) => count < 4)
    .map(({ device, locale, count }) => ({
      code: "android-tablet-screen-count" as const,
      platform: "android" as const,
      device,
      locale,
      screenCount: count,
      message: `${device} locale ${locale} has ${count} screen${count === 1 ? "" : "s"}; four or more are recommended.`,
    }));
}

export function leadStoreSizeId(platform: string, device: string): string {
  const family = OUTPUT_DEVICE_FAMILIES.find(({ key }) => key === `${platform}/${device}`);
  if (!family) throw new Error(`No lead store size configured for ${platform}/${device}`);
  return family.leadStoreSizeId;
}

export function selectBundleScreens(
  project: Project,
  layoutId: string,
  filters: BundleFilters = {},
): Screen[] {
  const screens = getLayout(project, layoutId).screens.filter((screen) => {
    if (filters.platform && screen.platform !== filters.platform) return false;
    if (filters.device && screen.device !== filters.device) return false;
    if (filters.locale && screen.locale !== filters.locale) return false;
    return true;
  });

  if (screens.length === 0) {
    const parts = [
      filters.platform ? `platform=${filters.platform}` : undefined,
      filters.device ? `device=${filters.device}` : undefined,
      filters.locale ? `locale=${filters.locale}` : undefined,
    ].filter(Boolean);
    throw new Error(`No screens match bundle filters${parts.length ? ` (${parts.join(", ")})` : ""}`);
  }

  return screens;
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MAX_LOCALE_PATH_SEGMENT_LENGTH = 120;
const MAX_STORE_SIZE_PATH_TOKEN_LENGTH = 64;
const MAX_SCREEN_NAME_PATH_TOKEN_LENGTH = 96;

function encodePortableIdentity(value: string, allowDot = false): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const safe = (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39)
      || code === 0x2d
      || code === 0x5f
      || (allowDot && code === 0x2e);
    encoded += safe ? value[index]! : `~${code.toString(16).padStart(4, "0")}`;
  }
  return encoded;
}

/**
 * Encode an exact free-form locale as one portable, case-insensitive-filesystem-safe segment.
 * Lowercase ASCII, digits, `_`, and `-` stay readable; every other UTF-16 code unit is escaped.
 * The fixed prefix avoids Windows reserved filenames such as `con` and `aux`.
 */
export function safeLocalePathSegment(locale: string): string {
  const segment = `locale-${encodePortableIdentity(locale)}`;
  if (segment.length > MAX_LOCALE_PATH_SEGMENT_LENGTH) {
    throw new Error(`Locale identifier is too long for a portable export path (${locale.length} characters)`);
  }
  return segment;
}

/** Keep the exact store-size id for lookup, but encode its identity at the filename sink. */
export function safeStoreSizePathToken(sizeId: string): string {
  const token = encodePortableIdentity(sizeId, true) || "~empty";
  if (token.length > MAX_STORE_SIZE_PATH_TOKEN_LENGTH) {
    throw new Error(`Store-size id is too long for a portable export filename (${sizeId.length} characters)`);
  }
  return token;
}

export function bundleRelativePath(
  screen: Screen,
  target: Pick<StoreSize, "id">,
  groupIndex: number,
): string {
  const prefix = String(groupIndex + 1).padStart(2, "0");
  const safeName = (sanitizeSegment(screen.name) || sanitizeSegment(screen.id) || "screen")
    .slice(0, MAX_SCREEN_NAME_PATH_TOKEN_LENGTH);
  const localeSegment = safeLocalePathSegment(screen.locale);
  const targetToken = safeStoreSizePathToken(target.id);
  return `${screen.platform}/${screen.device}/${localeSegment}/${prefix}-${safeName}-${targetToken}.png`;
}

export function buildBundleEntries(
  project: Project,
  layoutId: string,
  specs: StoreSpecs,
  filters: BundleFilters = {},
): BundleEntry[] {
  const counts = new Map<string, Map<string, Map<string, Map<string, number>>>>();
  return selectBundleScreens(project, layoutId, filters).map((screen) => {
    let byDevice = counts.get(screen.platform);
    if (!byDevice) {
      byDevice = new Map();
      counts.set(screen.platform, byDevice);
    }
    let byLocale = byDevice.get(screen.device);
    if (!byLocale) {
      byLocale = new Map();
      byDevice.set(screen.device, byLocale);
    }
    let byTarget = byLocale.get(screen.locale);
    if (!byTarget) {
      byTarget = new Map();
      byLocale.set(screen.locale, byTarget);
    }
    const sizeId = screen.storeTargetId ?? leadStoreSizeId(screen.platform, screen.device);
    const groupIndex = byTarget.get(sizeId) ?? 0;
    byTarget.set(sizeId, groupIndex + 1);
    const target = findStoreTarget(specs, screen.platform, screen.device, sizeId);
    return { screen, target, relativePath: bundleRelativePath(screen, target, groupIndex) };
  });
}

/**
 * Fail before rendering if any root/variant artboard cannot scale to its selected target
 * (spec Slice 3). Mirrors the `exportPixelRatio` gate the render loop applies per entry, but
 * up front, so the UI/CLI reject an invalid bundle with a screen-identifying message instead of
 * failing mid-render.
 */
export function validateBundleArtboards(entries: BundleEntry[]): void {
  for (const entry of entries) {
    try {
      exportPixelRatio(entry.screen.artboard, { width: entry.target.width, height: entry.target.height });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Screen "${entry.screen.name}" (${entry.screen.id}) cannot scale to target "${entry.target.id}": ${message}`,
        { cause: err },
      );
    }
  }
}
