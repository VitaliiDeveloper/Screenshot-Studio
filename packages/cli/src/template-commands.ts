// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import {
  listBuiltInTemplatePackMetadata,
  type BuiltInTemplatePackMetadata,
  type ScreenTemplate,
} from "@screenshot-studio/core/templates";
import { templatePackMetadata } from "@screenshot-studio/core/packs";
import {
  createBuiltInTemplatePackScreens,
  createBuiltInTemplateScreen,
  createProjectTemplatePackScreens,
  createTemplateScreen,
  exportLayoutPack,
  listBuiltInTemplates,
  listTemplatesWithErrors,
  loadProjectPackListing,
  templateId,
} from "./template-service.js";

export type TemplateAction =
  | { kind: "list" }
  | { kind: "add"; id: string; locale: string; source: "project" | "built-in" | "pack" }
  | { kind: "export-pack"; layoutId: string; out: string; locale?: string; force: boolean };

const USAGE = "Usage: screenshots template <list|add <id> --locale <locale> [--built-in|--pack]|export-pack <layout-id> --out packs/<name> [--locale <locale>] [--force]> [--json]";

export function resolveTemplateAction(args: string[], flags: Record<string, string>): TemplateAction {
  const [subcommand, id, extra] = args;
  if (subcommand === "list" && !id) return { kind: "list" };
  if (subcommand === "export-pack" && id && !extra) {
    if (!flags.out) throw new Error("template export-pack requires --out packs/<name>");
    return { kind: "export-pack", layoutId: id, out: flags.out, locale: flags.locale, force: flags.force === "true" };
  }
  if (subcommand === "add" && id && !extra) {
    if (!flags.locale) throw new Error("template add requires --locale <locale>");
    const builtIn = flags["built-in"] === "true";
    const pack = flags.pack === "true";
    if (builtIn && pack) throw new Error("template add takes either --built-in or --pack, not both");
    const source = pack ? "pack" : builtIn ? "built-in" : "project";
    return { kind: "add", id: templateId(id), locale: flags.locale, source };
  }
  throw new Error(USAGE);
}

function formatTemplate(source: "built-in" | "project", template: ScreenTemplate): string {
  return `${source} ${template.id} ${template.platform}/${template.device} ${template.targetId ?? "-"} ${template.name}`;
}

function formatTemplatePack(source: "built-in" | "project", pack: BuiltInTemplatePackMetadata): string {
  return `${source}-pack ${pack.id} ${pack.platform}/${pack.device} ${pack.style} ${pack.screenCount} ${pack.name}`;
}

function templateSummary(template: ScreenTemplate) {
  return { id: template.id, platform: template.platform, device: template.device, targetId: template.targetId ?? null, name: template.name };
}

async function loadSpecs(storeSpecsPath: string): Promise<StoreSpecs> {
  return parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
}

export async function runTemplateCommand(
  projectPath: string,
  storeSpecsPath: string,
  args: string[],
  flags: Record<string, string>,
): Promise<string> {
  const action = resolveTemplateAction(args, flags);
  const json = flags.json === "true";
  if (action.kind === "export-pack") {
    const { dir, pack, assets, skipped } = await exportLayoutPack(projectPath, action.out, {
      layout: action.layoutId, locale: action.locale, force: action.force,
    });
    if (json) return JSON.stringify({ dir, pack: pack.id, screens: pack.screens.map((screen) => screen.id), assets, skipped });
    return [
      `Exported ${pack.screens.length} screen${pack.screens.length === 1 ? "" : "s"} (${pack.platform}/${pack.device}) and ${assets.length} asset${assets.length === 1 ? "" : "s"} to ${dir}`,
      ...(skipped.length > 0 ? [`Skipped screens of another output family: ${skipped.join(", ")}`] : []),
    ].join("\n");
  }
  const specs = await loadSpecs(storeSpecsPath);
  if (action.kind === "list") {
    const [builtIns, { definitions: templates, errors }, local] = await Promise.all([
      listBuiltInTemplates(projectPath, specs),
      listTemplatesWithErrors(projectPath),
      loadProjectPackListing(projectPath),
    ]);
    const packs = [
      ...listBuiltInTemplatePackMetadata().map((pack) => ({ source: "built-in" as const, pack })),
      ...local.packs.flatMap((entry) => entry.kind === "screen" ? [{ source: "project" as const, pack: templatePackMetadata(entry.pack) }] : []),
    ];
    if (json) {
      return JSON.stringify({
        templates: [
          ...builtIns.map((template) => ({ source: "built-in", ...templateSummary(template) })),
          ...templates.map((template) => ({ source: "project", ...templateSummary(template) })),
        ],
        packs: packs.map(({ source, pack }) => ({ source, ...pack })),
        errors: [...local.errors, ...errors.map(({ file, error }) => ({ file, message: error.message }))],
      });
    }
    return [
      ...builtIns.map((template) => formatTemplate("built-in", template)),
      ...packs.map(({ source, pack }) => formatTemplatePack(source, pack)),
      ...templates.map((template) => formatTemplate("project", template)),
      ...local.errors.map((error) => `invalid-pack ${error.file}: ${error.message}`),
      ...errors.map(({ file, error }) => `invalid-template ${file}: ${error.message}`),
    ].join("\n");
  }
  if (action.source === "pack") {
    // Project pack ids never repeat a built-in id, so the lookup order cannot shadow one.
    const builtIn = listBuiltInTemplatePackMetadata().some((pack) => pack.id === action.id);
    const { screens } = await (builtIn ? createBuiltInTemplatePackScreens : createProjectTemplatePackScreens)(
      projectPath, action.id, action.locale, specs, {}, flags.layout,
    );
    if (json) return JSON.stringify({ source: builtIn ? "built-in" : "project", pack: action.id, screens: screens.map((screen) => screen.id) });
    const first = screens[0]!;
    return `Added ${screens.length} screen${screens.length === 1 ? "" : "s"} (${first.platform}/${first.device} ${first.locale}) from ${builtIn ? "built-in" : "project"} pack ${action.id}: ${screens.map((screen) => screen.id).join(", ")}`;
  }
  const builtIn = action.source === "built-in";
  const { screen } = builtIn
    ? await createBuiltInTemplateScreen(projectPath, action.id, action.locale, specs, {}, flags.layout)
    : await createTemplateScreen(projectPath, action.id, action.locale, {}, flags.layout, {}, specs);
  if (json) return JSON.stringify({ source: builtIn ? "built-in" : "project", template: action.id, screens: [screen.id] });
  return `Added screen ${screen.id} (${screen.platform}/${screen.device} ${screen.locale}) from ${builtIn ? "built-in" : "project"} template ${action.id}`;
}
