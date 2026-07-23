// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/**
 * Loader + validator for store-specs.json. Store sizes are data, not hardcode
 * (docs/architecture.md): Apple/Google change them over time, so they live in one JSON
 * file that both export and its dimension tests read.
 */

const StoreSize = z
  .object({
    id: z.string(),
    label: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.enum(["portrait", "landscape", "square"]),
    kind: z.enum(["device", "promotion", "responsive"]).optional(),
    /** Device family whose root owns this non-device output target. */
    family: z.string().min(1).optional(),
    format: z.enum(["png", "jpeg", "png-or-jpeg"]).optional(),
    alpha: z.boolean().optional(),
  })
  .strict();
export type StoreSize = z.infer<typeof StoreSize>;

// Platform → device → sizes. `.passthrough()` at the platform level tolerates the leading
// "$comment" key without listing every platform explicitly.
const StoreSpecs = z.record(z.record(z.array(StoreSize)));
export type StoreSpecs = z.infer<typeof StoreSpecs>;

/** Reserved platform-level catalog for outputs that are not devices (for example promotions). */
export const STORE_OUTPUT_TARGETS_KEY = "$outputs";

export function parseStoreSpecs(raw: unknown): StoreSpecs {
  // Drop the documentation-only "$comment" key before validating.
  const { $comment: _drop, ...rest } = (raw ?? {}) as Record<string, unknown>;
  return StoreSpecs.parse(rest);
}

/** Find one size by platform/device/id, or throw with the valid options listed. */
export function findStoreSize(
  specs: StoreSpecs,
  platform: string,
  device: string,
  sizeId: string,
): StoreSize {
  const sizes = specs[platform]?.[device];
  if (!sizes) {
    throw new Error(`No store sizes for ${platform}/${device}`);
  }
  const size = sizes.find((s) => s.id === sizeId);
  if (!size) {
    throw new Error(
      `Unknown size "${sizeId}" for ${platform}/${device}. Known: ${sizes
        .map((s) => s.id)
        .join(", ")}`,
    );
  }
  return size;
}

/**
 * Return export targets owned by a screen family, including platform-level non-device outputs.
 * Device creation deliberately continues to use `findStoreSize`, so output targets never become
 * fake devices in the persisted screen schema.
 */
export function listStoreTargets(
  specs: StoreSpecs,
  platform: string,
  device: string,
): StoreSize[] {
  const deviceSizes = specs[platform]?.[device];
  if (!deviceSizes) throw new Error(`No store sizes for ${platform}/${device}`);
  const outputs = specs[platform]?.[STORE_OUTPUT_TARGETS_KEY] ?? [];
  return [
    ...deviceSizes,
    ...outputs.filter((target) => target.family === undefined || target.family === device),
  ];
}

/** Find either a device size or a platform output target owned by that device family. */
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
      `Unknown target "${targetId}" for ${platform}/${device}. Known: ${targets
        .map(({ id }) => id)
        .join(", ")}`,
    );
  }
  return target;
}
