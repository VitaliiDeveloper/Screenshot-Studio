// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  Background,
  Element,
  SCREEN_DEVICES_BY_PLATFORM,
} from "@screenshot-studio/core/model";

const templateBase = {
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug"),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  /** Optional export target materialized as an exact project-local screen. */
  targetId: z.string().min(1).optional(),
  artboard: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  background: Background,
  elements: z.array(Element),
};

export const ScreenTemplate = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("apple"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple), ...templateBase }).strict(),
  z.object({ platform: z.literal("android"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android), ...templateBase }).strict(),
  z.object({ platform: z.literal("windows"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.windows), ...templateBase }).strict(),
  z.object({ platform: z.literal("web"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.web), ...templateBase }).strict(),
]);
export type ScreenTemplate = z.infer<typeof ScreenTemplate>;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug");

/** Multi-screen set, built in or read from a project `packs/<id>/screen-pack.json`; each screen materializes as an ordinary Screen. */
export const TemplatePack = z.object({
  id: slug,
  name: z.string().min(1),
  description: z.string().min(1),
  platform: z.string().min(1),
  device: z.string().min(1),
  /** Style tag for catalog filtering; matches the built-in Design pack the screens were baked from. */
  style: slug,
  /** Art spans screen edges, which only a connected layout renders. */
  panorama: z.literal(true).optional(),
  screens: z.array(ScreenTemplate).min(1),
}).strict().superRefine((pack, context) => {
  pack.screens.forEach((screen, index) => {
    if (screen.platform !== pack.platform || screen.device !== pack.device) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["screens", index],
        message: `expected ${pack.platform}/${pack.device} screen`,
      });
    }
  });
});
export type TemplatePack = z.infer<typeof TemplatePack>;

export function parseTemplateJson(json: string): ScreenTemplate {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`Template file is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  const result = ScreenTemplate.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid template JSON:\n${issues}`);
  }
  return result.data;
}
