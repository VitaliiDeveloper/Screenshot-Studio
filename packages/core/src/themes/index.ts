// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  HexColor,
  Project,
  THEME_ROLES,
  type Project as ProjectModel,
} from "../model/schema.js";
import { fontIdentityKey } from "../model/font-identity.js";

const ThemeFont = z
  .object({
    family: z.string().min(1),
    weight: z.number().int().min(100).max(900).default(400),
  })
  .strict();

const roleMap = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      heading: value,
      body: value,
      accent: value,
      surface: value,
    })
    .strict();

const optionalRoleFonts = z
  .object({
    heading: ThemeFont.optional(),
    body: ThemeFont.optional(),
    accent: ThemeFont.optional(),
    surface: ThemeFont.optional(),
  })
  .strict();

export const Theme = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug"),
    name: z.string().min(1),
    colors: roleMap(HexColor),
    fonts: optionalRoleFonts.default({}),
  })
  .strict();
export type Theme = z.infer<typeof Theme>;

export function parseThemeJson(json: string): Theme {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`Theme file is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  const result = Theme.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid theme JSON:\n${issues}`);
  }
  return result.data;
}

function assertThemeFontsRegistered(project: ProjectModel, theme: Theme): void {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  for (const role of THEME_ROLES) {
    const font = theme.fonts[role];
    if (font && !registered.has(fontIdentityKey(font))) {
      throw new Error(
        `Theme "${theme.id}" requires unregistered font "${font.family}" ${font.weight} for role "${role}"`,
      );
    }
  }
}

/** Bake theme tokens into literal project fields; rendering stays theme-agnostic. */
export function applyTheme(project: ProjectModel, input: Theme): ProjectModel {
  const theme = Theme.parse(input);
  assertThemeFontsRegistered(project, theme);

  const screens = project.screens.map((screen) => ({
    ...screen,
    elements: screen.elements.map((element) => {
      if (!element.role) return element;
      if (element.type === "text") {
        const font = theme.fonts[element.role];
        return {
          ...element,
          color: theme.colors[element.role],
          ...(font ? { fontFamily: font.family, weight: font.weight } : {}),
        };
      }
      if (element.type === "shape") {
        return { ...element, fill: theme.colors[element.role] };
      }
      return element;
    }),
  }));

  return Project.parse({ ...project, screens });
}
