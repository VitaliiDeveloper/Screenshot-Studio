// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  Background,
  Element,
  Project,
  SCREEN_DEVICES_BY_PLATFORM,
  addScreenToProject,
  setScreenDirection,
  type Project as ProjectModel,
  type Screen,
} from "../model/index.js";
import { fontIdentityKey } from "../model/font-identity.js";

const templateBase = {
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug"),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  artboard: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  background: Background,
  elements: z.array(Element),
};

export const ScreenTemplate = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("apple"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple), ...templateBase }).strict(),
  z.object({ platform: z.literal("android"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android), ...templateBase }).strict(),
]);
export type ScreenTemplate = z.infer<typeof ScreenTemplate>;

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

function assertTemplateFontsRegistered(project: ProjectModel, template: ScreenTemplate): void {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  const missing = new Set<string>();
  for (const element of template.elements) {
    if (element.type !== "text") continue;
    const key = fontIdentityKey({ family: element.fontFamily, weight: element.weight });
    if (!registered.has(key)) missing.add(`"${element.fontFamily}" ${element.weight}`);
  }
  if (missing.size > 0) {
    throw new Error(
      `Template "${template.id}" requires unregistered font identities: ${Array.from(missing).join(", ")}`,
    );
  }
}

export function createScreenFromTemplate(
  project: ProjectModel,
  input: ScreenTemplate,
  locale: string,
): { project: ProjectModel; screen: Screen } {
  const template = ScreenTemplate.parse(input);
  if (!locale.trim()) throw new Error("Template screen locale must not be empty");
  assertTemplateFontsRegistered(project, template);
  const elements = template.elements.map((element) => ({ ...structuredClone(element), id: crypto.randomUUID() }));
  const common = {
    id: template.id,
    name: template.name,
    locale,
    artboard: template.artboard,
    backgroundColor: template.background.color,
    elements,
  };
  const nextProject = template.platform === "apple"
    ? addScreenToProject(project, { ...common, platform: "apple", device: template.device })
    : addScreenToProject(project, { ...common, platform: "android", device: template.device });
  const screen = nextProject.screens.at(-1)!;
  if (screen.direction === "ltr") return { project: Project.parse(nextProject), screen };

  // Template geometry is authored as physical LTR literals. Bake the target locale direction
  // once before persistence; render must never mirror template geometry implicitly.
  const localized = setScreenDirection({ ...screen, direction: "ltr" }, screen.direction);
  const localizedProject = Project.parse({
    ...nextProject,
    screens: [...nextProject.screens.slice(0, -1), localized],
  });
  return { project: localizedProject, screen: localized };
}
