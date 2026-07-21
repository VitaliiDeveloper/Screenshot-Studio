// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  FontWeight,
  HexColor,
  THEME_ROLES,
  type Project as ProjectModel,
} from "../model/schema.js";
import { fontIdentityKey } from "../model/font-identity.js";
import { DEFAULT_TEXT_FONT, isBuiltInFontIdentity } from "../model/built-in-fonts.js";
import { mapElementLeaves } from "../model/element-tree.js";
import { getLayout, replaceLayout } from "../model/project-layout.js";

const ThemeFont = z
  .object({
    family: z.string().min(1),
    weight: FontWeight,
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

const DesignPackTypography = ThemeFont.extend({
  size: z.number().positive(),
  lineHeight: z.number().positive(),
  letterSpacing: z.number(),
}).strict();

export const DesignPack = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug"),
  name: z.string().min(1),
  description: z.string().min(1),
  palette: roleMap(HexColor),
  typography: roleMap(DesignPackTypography),
  spacing: z.object({
    compact: z.number().finite().min(0),
    regular: z.number().finite().min(0),
    spacious: z.number().finite().min(0),
  }).strict(),
}).strict();
export type DesignPack = z.infer<typeof DesignPack>;

const BUILT_IN_DESIGN_PACKS: readonly DesignPack[] = [DesignPack.parse({
  id: "neutral-default",
  name: "Neutral default",
  description: "A calm slate palette, balanced type scale, and practical spacing rhythm.",
  palette: {
    heading: "#0F172A",
    body: "#475569",
    accent: "#2563EB",
    surface: "#F1F5F9",
  },
  typography: {
    heading: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, size: 64, lineHeight: 1.08, letterSpacing: -1 },
    body: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, size: 32, lineHeight: 1.35, letterSpacing: 0 },
    accent: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, size: 28, lineHeight: 1.2, letterSpacing: 0 },
    surface: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, size: 28, lineHeight: 1.2, letterSpacing: 0 },
  },
  spacing: { compact: 8, regular: 16, spacious: 24 },
})];

/** Process-global, read-only catalog. Callers receive detached literals. */
export function listBuiltInDesignPacks(): DesignPack[] {
  return BUILT_IN_DESIGN_PACKS.map((pack) => DesignPack.parse(structuredClone(pack)));
}

export function findBuiltInDesignPack(id: string): DesignPack | undefined {
  return listBuiltInDesignPacks().find((pack) => pack.id === id);
}

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
    if (font && !registered.has(fontIdentityKey(font)) && !isBuiltInFontIdentity(font)) {
      throw new Error(
        `Theme "${theme.id}" requires unregistered font "${font.family}" ${font.weight} for role "${role}"`,
      );
    }
  }
}

function assertDesignPackFontsRegistered(project: ProjectModel, pack: DesignPack): void {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  for (const role of THEME_ROLES) {
    const font = pack.typography[role];
    if (!registered.has(fontIdentityKey(font)) && !isBuiltInFontIdentity(font)) {
      throw new Error(
        `Design pack "${pack.id}" requires unregistered font "${font.family}" ${font.weight} for role "${role}"`,
      );
    }
  }
}

/** Bake theme tokens into literal project fields; rendering stays theme-agnostic. */
export function applyTheme(project: ProjectModel, layoutId: string, input: Theme): ProjectModel {
  const theme = Theme.parse(input);
  assertThemeFontsRegistered(project, theme);
  const layout = getLayout(project, layoutId);

  const screens = layout.screens.map((screen) => ({
    ...screen,
    elements: screen.elements.map((element) => mapElementLeaves(element, (leaf) => {
      if (!leaf.role) return leaf;
      if (leaf.type === "text") {
        const font = theme.fonts[leaf.role];
        return {
          ...leaf,
          color: theme.colors[leaf.role],
          ...(font ? { fontFamily: font.family, weight: font.weight } : {}),
        };
      }
      if (leaf.type === "shape") {
        return { ...leaf, fill: theme.colors[leaf.role] };
      }
      return leaf;
    })),
  }));

  return replaceLayout(project, { ...layout, screens });
}

/**
 * Bake a global pack into the same render-bearing literals used by the editor and CLI. The pack id
 * is never persisted. Role metadata remains only so another pack/theme can be intentionally baked.
 */
export function applyDesignPack(
  project: ProjectModel,
  layoutId: string,
  input: DesignPack,
): ProjectModel {
  const pack = DesignPack.parse(input);
  assertDesignPackFontsRegistered(project, pack);
  const layout = getLayout(project, layoutId);
  const roleSpacing = {
    heading: pack.spacing.spacious,
    body: pack.spacing.regular,
    accent: pack.spacing.compact,
    surface: pack.spacing.spacious,
  } as const;
  const snap = (value: number, step: number) => step === 0 ? value : Math.round(value / step) * step;
  const screens = layout.screens.map((screen) => ({
    ...screen,
    elements: screen.elements.map((element) => mapElementLeaves(element, (leaf) => {
      if (!leaf.role) return leaf;
      const spacing = roleSpacing[leaf.role];
      const position = { x: snap(leaf.x, spacing), y: snap(leaf.y, spacing) };
      if (leaf.type === "text") {
        const typography = pack.typography[leaf.role];
        return {
          ...leaf,
          ...position,
          color: pack.palette[leaf.role],
          fontFamily: typography.family,
          weight: typography.weight,
          size: typography.size,
          lineHeight: typography.lineHeight,
          letterSpacing: typography.letterSpacing,
        };
      }
      if (leaf.type === "shape") {
        return {
          ...leaf,
          ...position,
          fill: pack.palette[leaf.role],
        };
      }
      if (leaf.type === "icon") return { ...leaf, ...position, color: pack.palette[leaf.role] };
      return { ...leaf, ...position };
    })),
  }));
  return replaceLayout(project, { ...layout, screens });
}
