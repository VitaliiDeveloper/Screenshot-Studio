// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { collectImageUrls } from "../assets/index.js";
import type { StoreSpecs } from "../export/index.js";
import {
  CanvasMode,
  HexColor,
  Project,
  ProjectRelativePath,
  SCHEMA_VERSION,
  SCREEN_DEVICES_BY_PLATFORM,
  parseProject,
  type Platform,
  type Project as ProjectModel,
} from "../model/index.js";

export const PROJECT_DOCUMENT_FILENAME = "app-store-screenshots.json";
export const PROJECT_NAME_MAX_LENGTH = 120;
export const PROJECT_TEMPLATE_GRADIENT_ANGLE_DEGREES = 135;

const STARTER_PANEL_WIDTH_RATIO = 0.72;
const STARTER_PANEL_HEIGHT_RATIO = 0.18;
const STARTER_PANEL_TOP_RATIO = 0.18;
const STARTER_PANEL_VERTICAL_STEP_RATIO = 0.04;
const STARTER_PANEL_RADIUS_RATIO = 0.12;

const ProjectPlatform = z.enum(["apple", "android", "windows"]);

export const ProjectScaffoldInput = z.object({
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
  platform: ProjectPlatform,
  layoutMode: CanvasMode,
  templateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
}).strict();
export type ProjectScaffoldInput = z.infer<typeof ProjectScaffoldInput>;

const ProjectTemplatePreview = z.object({
  backgroundFrom: HexColor,
  backgroundTo: HexColor,
  accent: HexColor,
}).strict();

export const ProjectTemplateSummary = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  intendedUse: z.string().min(1),
  supportedPlatforms: z.array(ProjectPlatform).min(1),
  preview: ProjectTemplatePreview,
}).strict();
export type ProjectTemplateSummary = z.infer<typeof ProjectTemplateSummary>;

export const ProjectScaffoldResource = z.object({
  path: ProjectRelativePath,
  bytes: z.instanceof(Uint8Array),
}).strict();
export type ProjectScaffoldResource = z.infer<typeof ProjectScaffoldResource>;

export const ProjectScaffold = z.object({
  project: Project,
  resources: z.array(ProjectScaffoldResource),
}).strict();
export type ProjectScaffold = z.infer<typeof ProjectScaffold>;

export interface ProjectScaffoldFile {
  path: string;
  bytes: Uint8Array;
}

interface StarterProjectTemplate extends ProjectTemplateSummary {
  screenCount: number;
}

const STARTER_PROJECT_TEMPLATES: readonly StarterProjectTemplate[] = [
  {
    id: "feature-focus",
    name: "Feature focus",
    description: "A crisp two-screen foundation with strong focal panels.",
    intendedUse: "Introduce one primary benefit and reinforce it with a supporting proof point.",
    supportedPlatforms: ["apple", "android", "windows"],
    preview: { backgroundFrom: "#0F172A", backgroundTo: "#1D4ED8", accent: "#38BDF8" },
    screenCount: 2,
  },
  {
    id: "product-launch",
    name: "Product launch",
    description: "A three-screen launch sequence with a bold gradient rhythm.",
    intendedUse: "Present a new product, highlight momentum, and close with a clear visual payoff.",
    supportedPlatforms: ["apple", "android"],
    preview: { backgroundFrom: "#312E81", backgroundTo: "#DB2777", accent: "#FDE047" },
    screenCount: 3,
  },
] as const;

const LEAD_DEVICE_BY_PLATFORM = {
  apple: "iphone",
  android: "phone",
  windows: "desktop",
} as const satisfies { [Key in Platform]: (typeof SCREEN_DEVICES_BY_PLATFORM)[Key][number] };

export function listStarterProjectTemplates(): ProjectTemplateSummary[] {
  return STARTER_PROJECT_TEMPLATES.map(({ screenCount: _screenCount, ...summary }) => (
    ProjectTemplateSummary.parse(structuredClone(summary))
  ));
}

function leadArtboard(specs: StoreSpecs, platform: Platform): { width: number; height: number } {
  const device = LEAD_DEVICE_BY_PLATFORM[platform];
  const size = specs[platform]?.[device]?.[0];
  if (!size) throw new Error(`No lead store size is configured for ${platform}/${device}`);
  return { width: size.width, height: size.height };
}

function commonElement(index: number, artboard: { width: number; height: number }, accent: string) {
  const width = Math.max(1, Math.round(artboard.width * STARTER_PANEL_WIDTH_RATIO));
  const height = Math.max(1, Math.round(artboard.height * STARTER_PANEL_HEIGHT_RATIO));
  const x = Math.round((artboard.width - width) / 2);
  const y = Math.round(artboard.height * (
    STARTER_PANEL_TOP_RATIO + index * STARTER_PANEL_VERTICAL_STEP_RATIO
  ));
  return {
    id: `panel-${index + 1}`,
    type: "shape" as const,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    kind: "rect" as const,
    fill: accent,
    radius: Math.max(1, Math.round(Math.min(width, height) * STARTER_PANEL_RADIUS_RATIO)),
  };
}

function createRawProject(
  input: ProjectScaffoldInput,
  specs: StoreSpecs,
  template: StarterProjectTemplate | undefined,
): unknown {
  const artboard = leadArtboard(specs, input.platform);
  const device = LEAD_DEVICE_BY_PLATFORM[input.platform];
  const screenCount = template?.screenCount ?? 1;
  const colors = template?.preview ?? {
    backgroundFrom: "#0B1020",
    backgroundTo: "#0B1020",
    accent: "#334155",
  };
  const screens = Array.from({ length: screenCount }, (_, index) => ({
    id: index === 0 ? "hero" : `story-${index + 1}`,
    name: index === 0 ? "Hero" : `Story ${index + 1}`,
    platform: input.platform,
    device,
    locale: "en",
    direction: "ltr",
    artboard,
    background: template
      ? {
          type: "linear-gradient",
          from: index % 2 === 0 ? colors.backgroundFrom : colors.backgroundTo,
          to: index % 2 === 0 ? colors.backgroundTo : colors.backgroundFrom,
          angle: PROJECT_TEMPLATE_GRADIENT_ANGLE_DEGREES,
        }
      : { type: "solid", color: colors.backgroundFrom },
    elements: template ? [commonElement(index, artboard, colors.accent)] : [],
  }));
  return {
    meta: { name: input.name, schemaVersion: SCHEMA_VERSION },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Default", mode: input.layoutMode, screens }],
  };
}

function requiredResourcePaths(project: ProjectModel): string[] {
  const paths = new Set(collectImageUrls(project));
  if (project.meta.appIcon) paths.add(project.meta.appIcon);
  for (const font of project.fonts) paths.add(font.path);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function validateProjectScaffold(scaffold: ProjectScaffold): ProjectScaffold {
  const parsed = ProjectScaffold.parse(scaffold);
  const paths = new Map<string, string>();
  const exactPaths = new Set<string>();
  for (const resource of parsed.resources) {
    const folded = resource.path.normalize("NFC").toLocaleLowerCase();
    if (folded === PROJECT_DOCUMENT_FILENAME) {
      throw new Error(`${PROJECT_DOCUMENT_FILENAME} is reserved for the generated project document`);
    }
    const existing = paths.get(folded);
    if (existing) throw new Error(`Duplicate portable scaffold resource path: ${existing} and ${resource.path}`);
    paths.set(folded, resource.path);
    exactPaths.add(resource.path);
  }
  const missing = requiredResourcePaths(parsed.project).filter((path) => !exactPaths.has(path));
  if (missing.length > 0) throw new Error(`Project scaffold is missing required resources: ${missing.join(", ")}`);
  return parsed;
}

export function createProjectScaffold(input: ProjectScaffoldInput, specs: StoreSpecs): ProjectScaffold {
  const parsedInput = ProjectScaffoldInput.parse(input);
  const template = parsedInput.templateId === null
    ? undefined
    : STARTER_PROJECT_TEMPLATES.find(({ id }) => id === parsedInput.templateId);
  if (parsedInput.templateId !== null && !template) {
    throw new Error(`Unknown project template: ${parsedInput.templateId}`);
  }
  if (template && !template.supportedPlatforms.includes(parsedInput.platform)) {
    throw new Error(`Project template "${template.id}" does not support ${parsedInput.platform}`);
  }
  return validateProjectScaffold({
    project: parseProject(createRawProject(parsedInput, specs, template)),
    resources: [],
  });
}

export function projectScaffoldFiles(scaffold: ProjectScaffold): ProjectScaffoldFile[] {
  const validated = validateProjectScaffold(scaffold);
  const resources = [...validated.resources].sort((left, right) => left.path.localeCompare(right.path));
  return [
    {
      path: PROJECT_DOCUMENT_FILENAME,
      bytes: new TextEncoder().encode(`${JSON.stringify(validated.project, null, 2)}\n`),
    },
    ...resources,
  ];
}
