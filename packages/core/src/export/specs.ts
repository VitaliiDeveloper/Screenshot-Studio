import { z } from "zod";

/**
 * Loader + validator for store-specs.json. Store sizes are data, not hardcode
 * (docs/architecture.md §4): Apple/Google change them over time, so they live in one JSON
 * file that both export and its dimension tests read.
 */

const StoreSize = z
  .object({
    id: z.string(),
    label: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.enum(["portrait", "landscape"]),
  })
  .strict();
export type StoreSize = z.infer<typeof StoreSize>;

// Platform → device → sizes. `.passthrough()` at the platform level tolerates the leading
// "$comment" key without listing every platform explicitly.
const StoreSpecs = z.record(z.record(z.array(StoreSize)));
export type StoreSpecs = z.infer<typeof StoreSpecs>;

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
