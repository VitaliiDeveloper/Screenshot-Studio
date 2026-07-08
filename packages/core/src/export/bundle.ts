import type { Project, Screen } from "../model/index.js";
import { findStoreSize, type StoreSize, type StoreSpecs } from "./specs.js";
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

const LEAD_SIZE_BY_PLATFORM_DEVICE = {
  apple: { iphone: "6.9", ipad: "13" },
  android: { phone: "phone-portrait" },
} as const;

export function leadStoreSizeId(platform: string, device: string): string {
  const byDevice = LEAD_SIZE_BY_PLATFORM_DEVICE[platform as keyof typeof LEAD_SIZE_BY_PLATFORM_DEVICE];
  const id = byDevice?.[device as keyof typeof byDevice];
  if (!id) throw new Error(`No lead store size configured for ${platform}/${device}`);
  return id;
}

export function selectBundleScreens(project: Project, filters: BundleFilters = {}): Screen[] {
  const screens = project.screens.filter((screen) => {
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

export function bundleRelativePath(screen: Screen, target: Pick<StoreSize, "id">, index: number): string {
  const prefix = String(index + 1).padStart(2, "0");
  const safeName = sanitizeSegment(screen.name) || sanitizeSegment(screen.id) || "screen";
  return `${screen.platform}/${screen.device}/${screen.locale}/${prefix}-${safeName}-${target.id}.png`;
}

export function buildBundleEntries(
  project: Project,
  specs: StoreSpecs,
  filters: BundleFilters = {},
): BundleEntry[] {
  return selectBundleScreens(project, filters).map((screen, index) => {
    const sizeId = leadStoreSizeId(screen.platform, screen.device);
    const target = findStoreSize(specs, screen.platform, screen.device, sizeId);
    return { screen, target, relativePath: bundleRelativePath(screen, target, index) };
  });
}

/**
 * Fail before rendering if any bundle entry's artboard cannot scale to its lead target
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
