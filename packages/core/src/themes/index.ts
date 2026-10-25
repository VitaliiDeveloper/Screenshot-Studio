// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  FontWeight,
  HexColor,
  LinearGradientBackground,
  SolidBackground,
  THEME_ROLES,
  DEFAULT_TEXT_FONT,
  fontIdentityKey,
  getLayout,
  isBuiltInFontIdentity,
  mapElementLeaves,
  mirrorBackground,
  replaceLayout,
  type Project as ProjectModel,
} from "@screenshot-studio/core/model";

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

/** Sizes scale with the artboard so one pack fits every target from 384 to 3840 px. */
const DesignPackTypography = ThemeFont.extend({
  /** Font size as a fraction of the artboard's short side. */
  sizeRatio: z.number().positive().max(1),
  lineHeight: z.number().positive(),
  /** Letter spacing as a fraction of the baked font size. */
  letterSpacingEm: z.number().finite(),
}).strict();

export const DesignPack = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug"),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Image backgrounds would need project assets, which a global pack cannot carry. */
  background: z.discriminatedUnion("type", [SolidBackground, LinearGradientBackground]),
  palette: roleMap(HexColor),
  typography: roleMap(DesignPackTypography),
}).strict();
export type DesignPack = z.infer<typeof DesignPack>;

const display = (weight: 400 | 600 | 800, sizeRatio: number, lineHeight: number, letterSpacingEm = 0) => ({
  family: "Screenshot Studio Display", weight, sizeRatio, lineHeight, letterSpacingEm,
});

const BUILT_IN_DESIGN_PACKS: readonly DesignPack[] = [DesignPack.parse({
  id: "neutral-default",
  name: "Neutral default",
  description: "A calm light slate background with dark, high-contrast type.",
  background: { type: "linear-gradient", from: "#F8FAFC", to: "#DBEAFE", angle: 135 },
  palette: {
    heading: "#0F172A",
    body: "#475569",
    accent: "#1D4ED8",
    surface: "#FFFFFF",
  },
  typography: {
    heading: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, sizeRatio: 0.075, lineHeight: 1.08, letterSpacingEm: -0.015 },
    body: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, sizeRatio: 0.035, lineHeight: 1.35, letterSpacingEm: 0 },
    accent: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, sizeRatio: 0.03, lineHeight: 1.2, letterSpacingEm: 0 },
    surface: { family: DEFAULT_TEXT_FONT.family, weight: DEFAULT_TEXT_FONT.weight, sizeRatio: 0.03, lineHeight: 1.2, letterSpacingEm: 0 },
  },
}), ...[
  {
    id: "clean",
    name: "Clean",
    description: "White space, centered copy, and quiet semibold type.",
    background: { type: "solid", color: "#FFFFFF" },
    palette: { heading: "#111827", body: "#4B5563", accent: "#1D4ED8", surface: "#F3F4F6" },
    typography: {
      heading: display(600, 0.08, 1.1, -0.02),
      body: display(400, 0.044, 1.4),
      accent: display(600, 0.026, 1.2, 0.08),
      surface: display(600, 0.04, 1.2),
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "A violet-to-pink gradient with soft glows and extra-bold type.",
    background: { type: "linear-gradient", from: "#3B0764", to: "#BE185D", angle: 160 },
    palette: { heading: "#FFFFFF", body: "#FCE7F3", accent: "#FDE68A", surface: "#2E1065" },
    typography: {
      heading: display(800, 0.09, 1.04, -0.025),
      body: display(400, 0.044, 1.4),
      accent: display(600, 0.026, 1.2, 0.1),
      surface: display(800, 0.04, 1.2),
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep navy, a cyan glow behind the device, and copy that alternates top and bottom.",
    background: { type: "linear-gradient", from: "#020617", to: "#1E293B", angle: 90 },
    palette: { heading: "#F8FAFC", body: "#94A3B8", accent: "#22D3EE", surface: "#1E293B" },
    typography: {
      heading: display(600, 0.075, 1.12, -0.01),
      body: display(400, 0.042, 1.45),
      accent: display(600, 0.024, 1.2, 0.16),
      surface: display(600, 0.04, 1.2),
    },
  },
  {
    id: "poster",
    name: "Poster",
    description: "Signal yellow, huge extra-bold headlines, and a device that runs off the bottom edge.",
    background: { type: "solid", color: "#FACC15" },
    palette: { heading: "#0A0A0A", body: "#292524", accent: "#0A0A0A", surface: "#FFFFFF" },
    typography: {
      heading: display(800, 0.105, 0.98, -0.035),
      body: display(600, 0.046, 1.3),
      accent: display(800, 0.028, 1.2, 0.04),
      surface: display(800, 0.042, 1.2),
    },
  },
  {
    id: "sunrise",
    name: "Sunrise",
    description: "A warm peach gradient with a generated sun and light editorial type.",
    background: { type: "linear-gradient", from: "#FFF7ED", to: "#FED7AA", angle: 90 },
    palette: { heading: "#7C2D12", body: "#9A3412", accent: "#9F3A10", surface: "#FFFFFF" },
    typography: {
      heading: display(400, 0.085, 1.1, -0.02),
      body: display(400, 0.044, 1.45),
      accent: display(600, 0.026, 1.2, 0.12),
      surface: display(600, 0.04, 1.2),
    },
  },
].map((pack) => DesignPack.parse(pack))];

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
 * Bake a global pack into the same render-bearing literals used by the editor and CLI: every screen
 * background plus role-tagged leaves. Geometry is left untouched; RTL screens get the mirrored
 * gradient direction, as a direction switch would bake it. The pack id is never persisted;
 * role metadata remains only so another pack/theme can be intentionally baked.
 */
export function applyDesignPack(
  project: ProjectModel,
  layoutId: string,
  input: DesignPack,
): ProjectModel {
  const pack = DesignPack.parse(input);
  assertDesignPackFontsRegistered(project, pack);
  const layout = getLayout(project, layoutId);
  const screens = layout.screens.map((screen) => {
    const shortSide = Math.min(screen.artboard.width, screen.artboard.height);
    const background = structuredClone(pack.background);
    return {
      ...screen,
      background: screen.direction === "rtl" ? mirrorBackground(background) : background,
      elements: screen.elements.map((element) => mapElementLeaves(element, (leaf) => {
        if (!leaf.role) return leaf;
        if (leaf.type === "text") {
          const typography = pack.typography[leaf.role];
          const size = Math.max(1, Math.round(shortSide * typography.sizeRatio));
          return {
            ...leaf,
            color: pack.palette[leaf.role],
            fontFamily: typography.family,
            weight: typography.weight,
            size,
            lineHeight: typography.lineHeight,
            letterSpacing: Math.round(size * typography.letterSpacingEm * 100) / 100,
          };
        }
        if (leaf.type === "shape") return { ...leaf, fill: pack.palette[leaf.role] };
        if (leaf.type === "icon") return { ...leaf, color: pack.palette[leaf.role] };
        return leaf;
      })),
    };
  });
  return replaceLayout(project, { ...layout, screens });
}
