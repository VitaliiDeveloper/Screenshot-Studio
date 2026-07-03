import { SCHEMA_VERSION } from "./schema.js";

/**
 * Migration seam. No migrations exist yet (we are at v1), but the entry point is here from
 * day 0 so that pure `vN → vN+1` steps can be added without touching load call sites, per
 * docs/roadmap.md ("State model is the one exception we design up front").
 *
 * Takes an unknown, still-unvalidated object (the raw parsed JSON) and returns an object at the
 * current `schemaVersion`, ready to hand to the Zod validator.
 */
export function migrateToCurrent(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const version = (raw as { meta?: { schemaVersion?: unknown } }).meta?.schemaVersion;
  if (version === SCHEMA_VERSION) return raw;
  // Future: while (version < SCHEMA_VERSION) raw = migrations[version](raw)
  return raw;
}
