// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import {
  listBuiltInTemplatePackMetadata,
  type BuiltInTemplatePackMetadata,
  type ScreenTemplate,
} from "@screenshot-studio/core/templates";
import {
  createBuiltInTemplatePackScreens,
  createBuiltInTemplateScreen,
  createTemplateScreen,
  listBuiltInTemplates,
  listTemplates,
  templateId,
} from "./template-service.js";

export type TemplateAction =
  | { kind: "list" }
  | { kind: "add"; id: string; locale: string; source: "project" | "built-in" | "pack" };

export function resolveTemplateAction(args: string[], flags: Record<string, string>): TemplateAction {
  const [subcommand, id, extra] = args;
  if (subcommand === "list" && !id) return { kind: "list" };
  if (subcommand === "add" && id && !extra) {
    if (!flags.locale) throw new Error("template add requires --locale <locale>");
    if (flags["built-in"] && flags.pack) throw new Error("template add takes either --built-in or --pack, not both");
    const source = flags.pack ? "pack" : flags["built-in"] ? "built-in" : "project";
    return { kind: "add", id: templateId(id), locale: flags.locale, source };
  }
  throw new Error("Usage: screenshots template <list|add <id> --locale <locale> [--built-in|--pack]>");
}

function formatTemplate(source: "built-in" | "project", template: ScreenTemplate): string {
  return `${source} ${template.id} ${template.platform}/${template.device} ${template.targetId ?? "-"} ${template.name}`;
}

function formatTemplatePack(pack: BuiltInTemplatePackMetadata): string {
  return `built-in-pack ${pack.id} ${pack.platform}/${pack.device} ${pack.style} ${pack.screenCount} ${pack.name}`;
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
  const specs = await loadSpecs(storeSpecsPath);
  if (action.kind === "list") {
    const [builtIns, templates] = await Promise.all([
      listBuiltInTemplates(projectPath, specs),
      listTemplates(projectPath),
    ]);
    return [
      ...builtIns.map((template) => formatTemplate("built-in", template)),
      ...listBuiltInTemplatePackMetadata().map(formatTemplatePack),
      ...templates.map((template) => formatTemplate("project", template)),
    ].join("\n");
  }
  if (action.source === "pack") {
    const { screens } = await createBuiltInTemplatePackScreens(projectPath, action.id, action.locale, specs, {}, flags.layout);
    const first = screens[0]!;
    return `Added ${screens.length} screen${screens.length === 1 ? "" : "s"} (${first.platform}/${first.device} ${first.locale}) from built-in pack ${action.id}: ${screens.map((screen) => screen.id).join(", ")}`;
  }
  const builtIn = action.source === "built-in";
  const { screen } = builtIn
    ? await createBuiltInTemplateScreen(projectPath, action.id, action.locale, specs, {}, flags.layout)
    : await createTemplateScreen(projectPath, action.id, action.locale, {}, flags.layout, {}, specs);
  return `Added screen ${screen.id} (${screen.platform}/${screen.device} ${screen.locale}) from ${builtIn ? "built-in" : "project"} template ${action.id}`;
}
