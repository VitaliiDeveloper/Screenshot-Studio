// SPDX-License-Identifier: Apache-2.0
export function comparePortable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function portablePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}
