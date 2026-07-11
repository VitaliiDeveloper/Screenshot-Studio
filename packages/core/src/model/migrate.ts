// SPDX-License-Identifier: Apache-2.0
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
  let version = meta.schemaVersion;
  if (version === SCHEMA_VERSION) return raw;

  let current = raw;
  if (version === 1) {
    // `mode` was unknown under strict v1. Refuse to reinterpret a hand-written future field as a
    // valid v2 value; valid v1 input always migrates pixel-preservingly to isolated mode.
    if (Object.prototype.hasOwnProperty.call(raw, "mode")) return raw;
    current = {
      ...raw,
      meta: { ...meta, schemaVersion: 2 },
      mode: "isolated",
    };
    version = 2;
  }

  if (version === 2) {
    // `group` was not legal in strict v2. Do not bless a mislabeled future document by changing
    // only its version; leave it untouched so the current schema rejects the old version.
    if (containsGroupElement(current)) return current;
    const currentMeta = current.meta;
    if (!isRecord(currentMeta)) return current;
    // v3 adds the group union member. Existing v2 leaf arrays need no structural rewrite.
    current = {
      ...current,
      meta: { ...currentMeta, schemaVersion: 3 },
    };
    version = 3;
  }

  if (version === 3) {
    // `image` was not legal in strict v3. Refuse a mislabeled v3 image document instead of
    // legitimising future data through a version-only migration.
    if (containsElementType(current, "image")) return current;
    const currentMeta = current.meta;
    if (!isRecord(currentMeta)) return current;
    current = {
      ...current,
      meta: { ...currentMeta, schemaVersion: 4 },
    };
    version = 4;
  }

  if (version === 4) {
    if (containsElementType(current, "icon")) return current;
    const currentMeta = current.meta;
    if (!isRecord(currentMeta)) return current;
    current = {
      ...current,
      meta: { ...currentMeta, schemaVersion: 5 },
    };
    version = 5;
  }

  if (version === 5) {
    if (containsStoreTargetVariant(current)) return current;
    const currentMeta = current.meta;
    if (!isRecord(currentMeta)) return current;
    return {
      ...current,
      meta: { ...currentMeta, schemaVersion: SCHEMA_VERSION },
    };
  }

  return raw;
}

function containsStoreTargetVariant(project: Record<string, unknown>): boolean {
  if (!Array.isArray(project.screens)) return false;
  return project.screens.some((screen) => isRecord(screen)
    && (Object.prototype.hasOwnProperty.call(screen, "variantOf")
      || Object.prototype.hasOwnProperty.call(screen, "storeTargetId")));
}

function containsGroupElement(project: Record<string, unknown>): boolean {
  return containsElementType(project, "group");
}

function containsElementType(project: Record<string, unknown>, type: string): boolean {
  if (!Array.isArray(project.screens)) return false;
  return project.screens.some((screen) => {
    if (!isRecord(screen) || !Array.isArray(screen.elements)) return false;
    return screen.elements.some((element) => elementContainsType(element, type));
  });
}

function elementContainsType(element: unknown, type: string): boolean {
  if (!isRecord(element)) return false;
  if (element.type === type) return true;
  return Array.isArray(element.children)
    && element.children.some((child) => elementContainsType(child, type));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
