// SPDX-License-Identifier: Apache-2.0

export function withOptionalNoFollow(base: number, noFollow: number | undefined): number {
  return base | (typeof noFollow === "number" ? noFollow : 0);
}
