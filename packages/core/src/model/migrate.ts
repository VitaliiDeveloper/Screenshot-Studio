import { SCHEMA_VERSION } from "./schema.js";

/**
 * Pure migration seam. Migrations run before the current strict schema so load call sites stay
 * unchanged, per
 * docs/roadmap.md ("State model is the one exception we design up front").
 *
 * Takes an unknown, still-unvalidated object (the raw parsed JSON) and returns an object at the
 * current `schemaVersion`, ready to hand to the Zod validator.
 */
export function migrateToCurrent(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const meta = raw.meta;
  if (!isRecord(meta)) return raw;
  const version = meta.schemaVersion;
  if (version === SCHEMA_VERSION) return raw;

  if (version === 1) {
    // `mode` was unknown under strict v1. Refuse to reinterpret a hand-written future field as a
    // valid v2 value; valid v1 input always migrates pixel-preservingly to isolated mode.
    if (Object.prototype.hasOwnProperty.call(raw, "mode")) return raw;
    return {
      ...raw,
      meta: { ...meta, schemaVersion: SCHEMA_VERSION },
      mode: "isolated",
    };
  }

  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
