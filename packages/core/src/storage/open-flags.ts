// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";

export function withOptionalNoFollow(base: number, noFollow: number | undefined): number {
  return base | (typeof noFollow === "number" ? noFollow : 0);
}

/** `base` plus `O_NOFOLLOW` where the platform defines it. */
export function noFollowFlags(base: number): number {
  return withOptionalNoFollow(base, constants.O_NOFOLLOW);
}
