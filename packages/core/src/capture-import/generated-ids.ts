// SPDX-License-Identifier: Apache-2.0
const RANDOM_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gu;

/**
 * JSON with every random UUID renamed by first appearance, so two plans built from the same input
 * compare equal although planning (and starter scaffolds) mint fresh variant and element ids.
 */
export function jsonIgnoringGeneratedIds(value: unknown): string {
  const ordinals = new Map<string, number>();
  return JSON.stringify(value).replace(RANDOM_UUID, (id) => {
    if (!ordinals.has(id)) ordinals.set(id, ordinals.size);
    // JSON.stringify escapes NUL, so the placeholder cannot match literal project text.
    return `\0${ordinals.get(id)}\0`;
  });
}
