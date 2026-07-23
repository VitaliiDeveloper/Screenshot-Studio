// SPDX-License-Identifier: Apache-2.0
import {
  LayoutDirection as LayoutDirectionSchema,
  type LayoutDirection,
} from "@screenshot-studio/core/model";

export function parseLayoutDirection(value: string, flag: "--direction" | "--to"): LayoutDirection {
  const result = LayoutDirectionSchema.safeParse(value);
  if (!result.success) throw new Error(`${flag} must be ltr or rtl`);
  return result.data;
}
