// SPDX-License-Identifier: Apache-2.0

export function isStrongQuotedETag(value: string): boolean {
  if (value.length < 3 || value[0] !== '"' || value.at(-1) !== '"') return false;
  for (const character of value.slice(1, -1)) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x20 || codePoint === 0x22 || codePoint === 0x7f) return false;
  }
  return true;
}
