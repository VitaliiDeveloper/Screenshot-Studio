// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { collectImageUrls } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  CanvasMode,
  DEFAULT_BLANK_SCREEN_COLOR,
  HexColor,
  Project,
  ProjectRelativePath,
  SCHEMA_VERSION,
  SCREEN_DEVICES_BY_PLATFORM,
  parseProject,
  removeScreenFromProject,
  reorderScreenInProject,
  setOutputFamilyScreenSetMode,
  getLayout,
  replaceLayout,
  type Platform,
  type Project as ProjectModel,
} from "@screenshot-studio/core/model";
import {
  createScreenFromTemplate,
  findBuiltInTemplate,
  listBuiltInProjectStarterMetadata,
} from "@screenshot-studio/core/templates";

export const PROJECT_DOCUMENT_FILENAME = "app-store-screenshots.json";
export const PROJECT_NAME_MAX_LENGTH = 120;
export const PROJECT_TEMPLATE_GRADIENT_ANGLE_DEGREES = 135;

const STARTER_PANEL_WIDTH_RATIO = 0.72;
const STARTER_PANEL_HEIGHT_RATIO = 0.18;
const STARTER_PANEL_TOP_RATIO = 0.18;
const STARTER_PANEL_VERTICAL_STEP_RATIO = 0.04;
const STARTER_PANEL_RADIUS_RATIO = 0.12;

const ProjectPlatform = z.enum(["apple", "android", "windows", "web"]);

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
    supportedPlatforms: ["apple", "android", "windows", "web"],
    preview: { backgroundFrom: "#0F172A", backgroundTo: "#1D4ED8", accent: "#38BDF8" },
    screenCount: 2,
  },
  {
    id: "product-launch",
    name: "Product launch",
    description: "A three-screen launch sequence with a bold gradient rhythm.",
    intendedUse: "Present a new product, highlight momentum, and close with a clear visual payoff.",
    supportedPlatforms: ["apple", "android", "web"],
    preview: { backgroundFrom: "#312E81", backgroundTo: "#DB2777", accent: "#FDE047" },
    screenCount: 3,
  },
] as const;

const LEAD_DEVICE_BY_PLATFORM = {
  apple: "iphone",
  android: "phone",
  windows: "desktop",
  web: "desktop",
} as const satisfies { [Key in Platform]: (typeof SCREEN_DEVICES_BY_PLATFORM)[Key][number] };

export function listStarterProjectTemplates(): ProjectTemplateSummary[] {
  const generic = STARTER_PROJECT_TEMPLATES.map(({ screenCount: _screenCount, ...summary }) => summary);
  const builtIns = listBuiltInProjectStarterMetadata().map((starter) => ({
    id: starter.id,
    name: starter.name,
    description: starter.description,
    intendedUse: "Start with an editable, correctly sized canvas and assign your own screenshot assets.",
    supportedPlatforms: [starter.platform],
    preview: { backgroundFrom: "#0F172A", backgroundTo: "#1D4ED8", accent: "#38BDF8" },
  }));
  return [...generic, ...builtIns].map((summary) => ProjectTemplateSummary.parse(structuredClone(summary)));
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
    backgroundFrom: DEFAULT_BLANK_SCREEN_COLOR,
    backgroundTo: DEFAULT_BLANK_SCREEN_COLOR,
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
  const projectTemplate = parsedInput.templateId === null
    ? undefined
    : STARTER_PROJECT_TEMPLATES.find(({ id }) => id === parsedInput.templateId);
  const builtInMetadata = parsedInput.templateId === null
    ? undefined
    : listBuiltInProjectStarterMetadata().find(({ id }) => id === parsedInput.templateId);
  if (parsedInput.templateId !== null && !projectTemplate && !builtInMetadata) {
    throw new Error(`Unknown project template: ${parsedInput.templateId}`);
  }
  if (projectTemplate && !projectTemplate.supportedPlatforms.includes(parsedInput.platform)) {
    throw new Error(`Project template "${projectTemplate.id}" does not support ${parsedInput.platform}`);
  }
  if (builtInMetadata && builtInMetadata.platform !== parsedInput.platform) {
    throw new Error(`Project template "${builtInMetadata.id}" does not support ${parsedInput.platform}`);
  }

  let project = parseProject(createRawProject(parsedInput, specs, projectTemplate));
  if (builtInMetadata) {
    const template = findBuiltInTemplate(builtInMetadata.id, specs);
    if (!template) throw new Error(`Unknown built-in screen template: ${builtInMetadata.id}`);
    const standaloneExactTarget = builtInMetadata.id === "play-feature-graphic";
    const materialized = createScreenFromTemplate(project, "default", template, "en", specs, {
      exactTargetMode: standaloneExactTarget ? "standalone" : "paired",
    });
    if (standaloneExactTarget) {
      const layout = getLayout(materialized.project, "default");
      project = replaceLayout(materialized.project, {
        ...layout,
        screens: layout.screens.filter((screen) => screen.id !== "hero"),
      });
    } else {
      project = removeScreenFromProject(materialized.project, "default", "hero");
      if (materialized.screen.variantOf) {
        project = reorderScreenInProject(project, "default", materialized.screen.id, 1);
      }
    }
  }
  const layout = getLayout(project, "default");
  const synchronizedFamilies = new Set<string>();
  for (const screen of layout.screens) {
    if (screen.storeTargetId !== undefined) continue;
    const key = `${screen.platform}\u0000${screen.device}\u0000${screen.locale}`;
    if (synchronizedFamilies.has(key)) continue;
    project = setOutputFamilyScreenSetMode(project, "default", screen.id, "synchronized");
    synchronizedFamilies.add(key);
  }
  return validateProjectScaffold({
    project,
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
