// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import rawOutputCatalog from "./output-catalog.json";
import { SCREEN_DEVICES_BY_PLATFORM, type Platform } from "./schema.js";

type DeviceByPlatform<P extends Platform> = (typeof SCREEN_DEVICES_BY_PLATFORM)[P][number];

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
  label: string;
  creatable: boolean;
  recommended: boolean;
  leadStoreSizeId: string;
  replacementKey?: OutputFamilyKey;
}

export interface OutputCatalog {
  schemaVersion: 1;
  destinations: readonly OutputDestination[];
  families: readonly OutputDeviceFamily[];
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && Object.hasOwn(SCREEN_DEVICES_BY_PLATFORM, value);
}

function isOutputFamilyKey(value: unknown): value is OutputFamilyKey {
  if (typeof value !== "string") return false;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator !== value.lastIndexOf("/")) return false;
  const platform = value.slice(0, separator);
  const device = value.slice(separator + 1);
  if (!isPlatform(platform)) return false;
  return (SCREEN_DEVICES_BY_PLATFORM[platform] as readonly string[]).includes(device);
}

const PlatformId = z.custom<Platform>(isPlatform, "Unknown output destination");
const FamilyKey = z.custom<OutputFamilyKey>(isOutputFamilyKey, "Unknown output family");

const OutputDestinationSchema = z.object({
  id: PlatformId,
  label: z.string().trim().min(1),
  shortLabel: z.string().trim().min(1),
  kind: z.enum(["store", "web"]),
}).strict();

const OutputDeviceFamilySchema = z.object({
  key: FamilyKey,
  label: z.string().trim().min(1),
  creatable: z.boolean(),
  recommended: z.boolean(),
  leadStoreSizeId: z.string().trim().min(1),
  replacementKey: FamilyKey.optional(),
}).strict();

const OutputCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  destinations: z.array(OutputDestinationSchema).min(1),
  families: z.array(OutputDeviceFamilySchema).min(1),
}).strict().superRefine((catalog, context) => {
  const expectedDestinations = Object.keys(SCREEN_DEVICES_BY_PLATFORM);
  const destinationIds = catalog.destinations.map(({ id }) => id);
  if (new Set(destinationIds).size !== destinationIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinations"], message: "Destination ids must be unique" });
  }
  for (const platform of expectedDestinations) {
    if (!destinationIds.includes(platform as Platform)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["destinations"], message: `Missing destination ${platform}` });
    }
  }

  const expectedFamilies = Object.entries(SCREEN_DEVICES_BY_PLATFORM)
    .flatMap(([platform, devices]) => devices.map((device) => `${platform}/${device}`));
  const familyKeys = catalog.families.map(({ key }) => key);
  if (new Set(familyKeys).size !== familyKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["families"], message: "Family keys must be unique" });
  }
  for (const key of expectedFamilies) {
    if (!familyKeys.includes(key as OutputFamilyKey)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["families"], message: `Missing output family ${key}` });
    }
  }

  for (const destination of catalog.destinations) {
    const recommended = catalog.families.filter(({ key, creatable, recommended: isRecommended }) =>
      key.startsWith(`${destination.id}/`) && creatable && isRecommended);
    if (recommended.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["families"],
        message: `Destination ${destination.id} must have exactly one creatable recommended family`,
      });
    }
  }

  for (const [index, family] of catalog.families.entries()) {
    if (family.recommended && !family.creatable) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["families", index, "recommended"], message: "A recommended family must be creatable" });
    }
    if (!family.creatable && !family.replacementKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["families", index, "replacementKey"], message: "A non-creatable family must declare its replacement" });
    }
    if (family.replacementKey) {
      const replacement = catalog.families.find(({ key }) => key === family.replacementKey);
      if (!replacement || replacement.key === family.key || !replacement.creatable) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["families", index, "replacementKey"], message: "Replacement must reference another creatable family" });
      }
    }
  }
});

/** Decode presentation and creation policy without widening the persisted Project schema. */
export function parseOutputCatalog(raw: unknown): OutputCatalog {
  const catalog = OutputCatalogSchema.parse(raw);
  return {
    schemaVersion: catalog.schemaVersion,
    destinations: catalog.destinations,
    families: catalog.families,
  };
}

const outputCatalog = parseOutputCatalog(rawOutputCatalog);

/** User-facing destination metadata. Persisted projects continue to store only the destination ID. */
export const OUTPUT_DESTINATIONS = outputCatalog.destinations;

/** Presentation and creation policy for every strict-schema output family. */
export const OUTPUT_DEVICE_FAMILIES = outputCatalog.families;

export function destinationLabel(platform: string): string {
  const destination = OUTPUT_DESTINATIONS.find(({ id }) => id === platform);
  if (!destination) throw new Error(`No output destination configured for ${platform}`);
  return destination.label;
}

export function outputFamilyLabel(platform: string, device: string): string {
  const family = OUTPUT_DEVICE_FAMILIES.find(({ key }) => key === `${platform}/${device}`);
  if (!family) throw new Error(`No output device family configured for ${platform}/${device}`);
  return `${destinationLabel(platform)} · ${family.label}`;
}
