// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
// The repository-root document is intentionally the one bundled default catalog.
// eslint-disable-next-line no-restricted-imports
import rawDefaultStoreSpecs from "../../../../store-specs.json";
import {
  SCREEN_DEVICES_BY_PLATFORM,
  type Platform,
} from "@screenshot-studio/core/model";

/**
 * Loader, validator, and selectors for the single store-specs.json catalog.
 * Persisted projects keep only stable platform/family/target ids; all presentation,
 * creation policy, and export dimensions are decoded from this data document.
 */

/** App Store Connect API `ScreenshotDisplayType` values for app screenshots. */
export const APP_STORE_DISPLAY_TYPES = [
  "APP_IPHONE_67", "APP_IPHONE_65", "APP_IPHONE_61", "APP_IPHONE_58", "APP_IPHONE_55", "APP_IPHONE_47",
  "APP_IPHONE_40", "APP_IPHONE_35", "APP_IPAD_PRO_3GEN_129", "APP_IPAD_PRO_3GEN_11", "APP_IPAD_PRO_129",
  "APP_IPAD_105", "APP_IPAD_97", "APP_WATCH_ULTRA", "APP_WATCH_SERIES_10", "APP_WATCH_SERIES_7",
  "APP_WATCH_SERIES_4", "APP_WATCH_SERIES_3", "APP_DESKTOP", "APP_APPLE_TV", "APP_APPLE_VISION_PRO",
] as const;
export type AppStoreDisplayType = (typeof APP_STORE_DISPLAY_TYPES)[number];

/** Where an App Store target uploads, or why App Store Connect has no screenshot set for it. */
const AppStoreConnectTargetSchema = z.union([
  z.object({ displayType: z.enum(APP_STORE_DISPLAY_TYPES) }).strict(),
  z.object({ unsupported: z.string().trim().min(1) }).strict(),
]);

const StoreSizeSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.enum(["portrait", "landscape", "square"]),
    /** Devices whose store listing shows this upload, newest first. */
    devices: z.array(z.string().trim().min(1)).min(1).optional(),
    kind: z.enum(["device", "promotion", "responsive"]).optional(),
    format: z.enum(["png", "jpeg", "png-or-jpeg"]).optional(),
    alpha: z.boolean().optional(),
    appStoreConnect: AppStoreConnectTargetSchema.optional(),
  })
  .strict();
export type StoreSize = z.infer<typeof StoreSizeSchema>;

const StoreFamilySchema = z
  .object({
    label: z.string().trim().min(1),
    creatable: z.boolean(),
    recommended: z.boolean(),
    leadStoreSizeId: z.string().trim().min(1),
    replacementKey: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/).optional(),
    targets: z.array(StoreSizeSchema).min(1),
  })
  .strict();
export type StoreFamily = z.infer<typeof StoreFamilySchema>;

const StorePlatformSchema = z
  .object({
    label: z.string().trim().min(1),
    shortLabel: z.string().trim().min(1),
    kind: z.enum(["store", "web"]),
    families: z.record(z.string(), StoreFamilySchema),
  })
  .strict();
export type StorePlatform = z.infer<typeof StorePlatformSchema>;

const StoreSpecsSchema = z
  .object({
    $comment: z.string().optional(),
    schemaVersion: z.literal(1),
    platforms: z.record(z.string(), StorePlatformSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const expectedPlatforms = Object.keys(SCREEN_DEVICES_BY_PLATFORM) as Platform[];
    const actualPlatforms = Object.keys(catalog.platforms);
    for (const platform of actualPlatforms) {
      if (!expectedPlatforms.includes(platform as Platform)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["platforms", platform],
          message: `Unknown platform ${platform}`,
        });
      }
    }
    for (const platform of expectedPlatforms) {
      const destination = catalog.platforms[platform];
      if (!destination) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["platforms", platform],
          message: `Missing platform ${platform}`,
        });
        continue;
      }

      const expectedFamilies = SCREEN_DEVICES_BY_PLATFORM[platform] as readonly string[];
      const actualFamilies = Object.keys(destination.families);
      for (const device of actualFamilies) {
        if (!expectedFamilies.includes(device)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["platforms", platform, "families", device],
            message: `Unknown output family ${platform}/${device}`,
          });
        }
      }
      for (const device of expectedFamilies) {
        if (!destination.families[device]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["platforms", platform, "families", device],
            message: `Missing output family ${platform}/${device}`,
          });
        }
      }

      const recommended = Object.values(destination.families).filter(
        (family) => family.creatable && family.recommended,
      );
      if (recommended.length !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["platforms", platform, "families"],
          message: `Platform ${platform} must have exactly one creatable recommended family`,
        });
      }
    }

    for (const [platform, destination] of Object.entries(catalog.platforms)) {
      for (const [device, family] of Object.entries(destination.families)) {
        const familyPath = ["platforms", platform, "families", device] as const;
        const targetIds = family.targets.map(({ id }) => id);
        if (new Set(targetIds).size !== targetIds.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...familyPath, "targets"],
            message: `Target ids must be unique within ${platform}/${device}`,
          });
        }
        const leadTarget = family.targets.find(({ id }) => id === family.leadStoreSizeId);
        if (!leadTarget) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...familyPath, "leadStoreSizeId"],
            message: `Primary target ${family.leadStoreSizeId} is not declared by ${platform}/${device}`,
          });
        } else if (leadTarget.kind === "promotion") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...familyPath, "leadStoreSizeId"],
            message: `Primary target ${family.leadStoreSizeId} cannot be promotional`,
          });
        }
        if (family.recommended && !family.creatable) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...familyPath, "recommended"],
            message: "A recommended family must be creatable",
          });
        }
        if (!family.creatable && !family.replacementKey) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...familyPath, "replacementKey"],
            message: "A non-creatable family must declare its replacement",
          });
        }

        const dimensionKeys = family.targets.map(
          ({ width, height, orientation }) => `${width}x${height}/${orientation}`,
        );
        if (new Set(dimensionKeys).size !== dimensionKeys.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...familyPath, "targets"],
            message: `Target dimensions must be unique within ${platform}/${device}`,
          });
        }

        family.targets.forEach((target, index) => {
          const orientationMatches = target.orientation === "square"
            ? target.width === target.height
            : target.orientation === "portrait"
              ? target.height > target.width
              : target.width > target.height;
          if (!orientationMatches) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...familyPath, "targets", index, "orientation"],
              message: `Orientation ${target.orientation} does not match ${target.width}x${target.height}`,
            });
          }
          if (platform !== "apple" && target.appStoreConnect !== undefined) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...familyPath, "targets", index, "appStoreConnect"],
              message: "Only App Store targets declare appStoreConnect",
            });
          }
        });

        if (family.replacementKey) {
          const [replacementPlatform, replacementDevice] = family.replacementKey.split("/") as [string, string];
          const replacement = catalog.platforms[replacementPlatform]?.families[replacementDevice];
          if (!replacement || family.replacementKey === `${platform}/${device}` || !replacement.creatable) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...familyPath, "replacementKey"],
              message: "Replacement must reference another creatable family",
            });
          }
        }
      }
    }
  });

type DeviceByPlatform<P extends Platform> = (typeof SCREEN_DEVICES_BY_PLATFORM)[P][number];
type StorePlatformFor<P extends Platform> = Omit<StorePlatform, "families"> & {
  families: { [D in DeviceByPlatform<P>]: StoreFamily };
};
type CatalogPlatform = { [P in Platform]: StorePlatformFor<P> }[Platform];

export interface StoreSpecs {
  schemaVersion: 1;
  platforms: { [P in Platform]: StorePlatformFor<P> };
}

export type OutputFamilyKey = {
  [P in Platform]: `${P}/${DeviceByPlatform<P>}`;
}[Platform];

export interface OutputDestination {
  id: Platform;
  label: string;
  shortLabel: string;
  kind: "store" | "web";
}

export interface OutputDeviceFamily {
  key: OutputFamilyKey;
  platform: Platform;
  device: string;
  label: string;
  creatable: boolean;
  recommended: boolean;
  leadStoreSizeId: string;
  replacementKey?: OutputFamilyKey;
}

/** Strictly decode the complete versioned catalog and remove its documentation-only comment. */
export function parseStoreSpecs(raw: unknown): StoreSpecs {
  const { $comment: _comment, ...catalog } = StoreSpecsSchema.parse(raw);
  return catalog as StoreSpecs;
}

export function listOutputDestinations(specs: StoreSpecs): OutputDestination[] {
  return (Object.entries(specs.platforms) as Array<[Platform, CatalogPlatform]>).map(
    ([id, { label, shortLabel, kind }]) => ({ id, label, shortLabel, kind }),
  );
}

export function listOutputFamilies(specs: StoreSpecs): OutputDeviceFamily[] {
  return (Object.entries(specs.platforms) as Array<[Platform, CatalogPlatform]>).flatMap(
    ([platform, destination]) => Object.entries(
      destination.families as Record<string, StoreFamily>,
    ).map(([device, family]) => ({
      key: `${platform}/${device}` as OutputFamilyKey,
      platform,
      device,
      label: family.label,
      creatable: family.creatable,
      recommended: family.recommended,
      leadStoreSizeId: family.leadStoreSizeId,
      ...(family.replacementKey ? { replacementKey: family.replacementKey as OutputFamilyKey } : {}),
    })),
  );
}

/** The repository catalog used by surfaces that do not accept an alternate store-specs path. */
export const DEFAULT_STORE_SPECS = parseStoreSpecs(rawDefaultStoreSpecs);
export const OUTPUT_DESTINATIONS = listOutputDestinations(DEFAULT_STORE_SPECS);
export const OUTPUT_DEVICE_FAMILIES = listOutputFamilies(DEFAULT_STORE_SPECS);

function configuredFamily(
  specs: StoreSpecs,
  platform: string,
  device: string,
): StoreFamily | undefined {
  const destination = specs.platforms[platform as Platform];
  return (destination?.families as Record<string, StoreFamily> | undefined)?.[device];
}

export function destinationLabel(platform: string, specs: StoreSpecs = DEFAULT_STORE_SPECS): string {
  const destination = specs.platforms[platform as Platform];
  if (!destination) throw new Error(`No output destination configured for ${platform}`);
  return destination.label;
}

export function outputFamilyLabel(
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  const destination = specs.platforms[platform as Platform];
  const family = configuredFamily(specs, platform, device);
  if (!family) throw new Error(`No output device family configured for ${platform}/${device}`);
  return `${destination.label} · ${family.label}`;
}

export function leadStoreSizeId(platform: string, device: string): string;
export function leadStoreSizeId(specs: StoreSpecs, platform: string, device: string): string;
export function leadStoreSizeId(
  specsOrPlatform: StoreSpecs | string,
  platformOrDevice: string,
  maybeDevice?: string,
): string {
  const specs = typeof specsOrPlatform === "string" ? DEFAULT_STORE_SPECS : specsOrPlatform;
  const platform = typeof specsOrPlatform === "string" ? specsOrPlatform : platformOrDevice;
  const device = typeof specsOrPlatform === "string" ? platformOrDevice : maybeDevice!;
  const family = configuredFamily(specs, platform, device);
  if (!family) throw new Error(`No lead store size configured for ${platform}/${device}`);
  return family.leadStoreSizeId;
}

/** Find one device/responsive size by platform/family/id, or throw with valid options listed. */
export function findStoreSize(
  specs: StoreSpecs,
  platform: string,
  device: string,
  sizeId: string,
): StoreSize {
  const targets = configuredFamily(specs, platform, device)?.targets;
  const sizes = targets?.filter(({ kind }) => kind !== "promotion");
  if (!sizes) throw new Error(`No store sizes for ${platform}/${device}`);
  const size = sizes.find(({ id }) => id === sizeId);
  if (!size) {
    throw new Error(
      `Unknown size "${sizeId}" for ${platform}/${device}. Known: ${sizes.map(({ id }) => id).join(", ")}`,
    );
  }
  return size;
}

/** Return every export target nested under one output family, including promotions. */
export function listStoreTargets(
  specs: StoreSpecs,
  platform: string,
  device: string,
): StoreSize[] {
  const targets = configuredFamily(specs, platform, device)?.targets;
  if (!targets) throw new Error(`No store sizes for ${platform}/${device}`);
  return targets;
}

/** Find either a device size or another output target owned by that family. */
export function findStoreTarget(
  specs: StoreSpecs,
  platform: string,
  device: string,
  targetId: string,
): StoreSize {
  const targets = listStoreTargets(specs, platform, device);
  const target = targets.find(({ id }) => id === targetId);
  if (!target) {
    throw new Error(
      `Unknown target "${targetId}" for ${platform}/${device}. Known: ${targets.map(({ id }) => id).join(", ")}`,
    );
  }
  return target;
}
