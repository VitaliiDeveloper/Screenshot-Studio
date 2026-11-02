// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  addScreenToProject,
  assertStandaloneSizeAllowed,
  cloneElementWithFreshIds,
  elementLeaves,
  ensureStoreTargetVariant,
  fontIdentityKey,
  fitElementsToArtboard,
  getLayout,
  isBuiltInFontIdentity,
  replaceLayout,
  setScreenDirection,
  type CreateScreenInput,
  type Project as ProjectModel,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  exportPixelRatio,
  findStoreTarget,
  leadStoreSizeId,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { ScreenTemplate, TemplatePack } from "./schemas.js";

function assertTemplateFontsRegistered(project: ProjectModel, template: ScreenTemplate): void {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  const missing = new Set<string>();
  for (const element of template.elements) {
    for (const leaf of elementLeaves(element)) {
      if (leaf.type !== "text") continue;
      const key = fontIdentityKey({ family: leaf.fontFamily, weight: leaf.weight });
      if (!registered.has(key)
        && !isBuiltInFontIdentity({ family: leaf.fontFamily, weight: leaf.weight })) {
        missing.add(`"${leaf.fontFamily}" ${leaf.weight}`);
      }
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `Template "${template.id}" requires unregistered font identities: ${Array.from(missing).join(", ")}`,
    );
  }
}

export function createScreenFromTemplate(
  project: ProjectModel,
  layoutId: string,
  input: ScreenTemplate,
  locale: string,
  specs?: StoreSpecs,
  options: { exactTargetMode?: "paired" | "standalone" } = {},
): { project: ProjectModel; screen: Screen } {
  const template = ScreenTemplate.parse(input);
  if (!locale.trim()) throw new Error("Template screen locale must not be empty");
  assertTemplateFontsRegistered(project, template);
  const append = (
    sourceProject: ProjectModel,
    artboard: { width: number; height: number },
    elements: ScreenTemplate["elements"],
    storeTargetId?: string,
  ): { project: ProjectModel; screen: Screen } => {
    const common = {
      id: template.id,
      name: template.name,
      locale,
      artboard,
      background: template.background,
      elements: elements.map((element) => cloneElementWithFreshIds(element)),
    };
    const existingIds = new Set(getLayout(sourceProject, layoutId).screens.map((screen) => screen.id));
    const added = addScreenToProject(sourceProject, layoutId, {
      ...common,
      platform: template.platform,
      device: template.device,
    } as CreateScreenInput);
    const layout = getLayout(added, layoutId);
    const created = layout.screens.filter((candidate) => !existingIds.has(candidate.id));
    const screen = created.find((candidate) => (
      candidate.variantOf === undefined && candidate.storeTargetId === undefined
    ));
    if (!screen) throw new Error(`Template "${template.id}" did not create a root screen`);
    const exactScreen = storeTargetId ? ScreenSchema.parse({ ...screen, storeTargetId }) : screen;
    // Template geometry is authored as physical LTR literals. Bake locale direction once.
    const localized = exactScreen.direction === "ltr"
      ? exactScreen
      : setScreenDirection({ ...exactScreen, direction: "ltr" }, exactScreen.direction);
    const replacements = new Map<string, Screen>([[screen.id, localized]]);
    for (const createdScreen of created) {
      if (createdScreen.id === screen.id || createdScreen.direction === "ltr") continue;
      replacements.set(
        createdScreen.id,
        setScreenDirection({ ...createdScreen, direction: "ltr" }, createdScreen.direction),
      );
    }
    if (replacements.size === 1 && localized === screen) return { project: added, screen };
    return {
      project: replaceLayout(added, {
        ...layout,
        screens: layout.screens.map((candidate) => replacements.get(candidate.id) ?? candidate),
      }),
      screen: localized,
    };
  };

  if (!template.targetId) return append(project, template.artboard, template.elements);
  if (!specs) throw new Error(`Template "${template.id}" requires store specs for target "${template.targetId}"`);

  const target = findStoreTarget(specs, template.platform, template.device, template.targetId);
  exportPixelRatio(template.artboard, target);
  if (options.exactTargetMode === "standalone") {
    assertStandaloneSizeAllowed(getLayout(project, layoutId), { platform: template.platform, device: template.device, locale });
    return append(project, template.artboard, template.elements, target.id);
  }
  const lead = findStoreTarget(
    specs,
    template.platform,
    template.device,
    leadStoreSizeId(specs, template.platform, template.device),
  );
  if (lead.id === target.id) return append(project, template.artboard, template.elements);

  // Root screens remain the family master. A non-lead starter is the exact target variant,
  // preserving export semantics without widening the persisted project schema.
  const leadArtboard = { width: lead.width, height: lead.height };
  const rootResult = append(
    project,
    leadArtboard,
    fitElementsToArtboard(template.elements, template.artboard, leadArtboard),
  );
  const variantResult = ensureStoreTargetVariant(
    rootResult.project,
    layoutId,
    rootResult.screen.id,
    target,
  );
  const layout = getLayout(variantResult.project, layoutId);
  const physicalVariant = ScreenSchema.parse({
    ...variantResult.variant,
    artboard: template.artboard,
    background: template.background,
    elements: template.elements.map((element) => cloneElementWithFreshIds(element)),
  });
  const variant = physicalVariant.direction === "ltr"
    ? physicalVariant
    : setScreenDirection({ ...physicalVariant, direction: "ltr" }, physicalVariant.direction);
  const nextProject = replaceLayout(variantResult.project, {
    ...layout,
    screens: layout.screens.map((screen) => screen.id === variant.id ? variant : screen),
  });
  return { project: nextProject, screen: variant };
}

/** Append every pack screen, in order, as ordinary screens of the layout. */
export function createScreensFromTemplatePack(
  project: ProjectModel,
  layoutId: string,
  input: TemplatePack,
  locale: string,
  specs: StoreSpecs,
): { project: ProjectModel; screens: Screen[] } {
  const pack = TemplatePack.parse(input);
  if (pack.panorama && getLayout(project, layoutId).mode !== "connected") {
    throw new Error(`Template pack "${pack.id}" spans screen edges; switch layout "${layoutId}" to Panorama first`);
  }
  let next = project;
  const screens: Screen[] = [];
  for (const template of pack.screens) {
    const result = createScreenFromTemplate(next, layoutId, template, locale, specs);
    next = result.project;
    screens.push(result.screen);
  }
  return { project: next, screens };
}
