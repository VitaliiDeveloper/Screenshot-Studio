// SPDX-License-Identifier: Apache-2.0

/** A plain JSON object: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` has exactly `keys` as own enumerable properties, in any order. */
export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && !actual.some((key) => !keys.includes(key));
}
