// SPDX-License-Identifier: Apache-2.0
export { ScreenTemplate, TemplatePack, parseTemplateJson } from "./schemas.js";
export {
  BUILT_IN_PROJECT_STARTER_IDS,
  BUILT_IN_TEMPLATE_IDS,
  findBuiltInTemplate,
  listBuiltInProjectStarterMetadata,
  listBuiltInTemplates,
  type BuiltInProjectStarterId,
  type BuiltInProjectStarterMetadata,
} from "./built-in-starters.js";
export {
  findBuiltInTemplatePack,
  listBuiltInTemplatePackMetadata,
  listBuiltInTemplatePacks,
  type BuiltInTemplatePackMetadata,
} from "./built-in-packs.js";
export { createScreenFromTemplate, createScreensFromTemplatePack } from "./materialize.js";
