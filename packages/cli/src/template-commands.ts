// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import type { ScreenTemplate } from "@screenshot-studio/core/templates";
import {
  createBuiltInTemplateScreen,
  createTemplateScreen,
  listBuiltInTemplates,
  listTemplates,
  templateId,
} from "./template-service.js";

export type TemplateAction =
  | { kind: "list" }
  | { kind: "add"; id: string; locale: string; builtIn: boolean };

export function resolveTemplateAction(args: string[], flags: Record<string, string>): TemplateAction {
  const [subcommand, id, extra] = args;
  if (subcommand === "list" && !id) return { kind: "list" };
  if (subcommand === "add" && id && !extra) {
    if (!flags.locale) throw new Error("template add requires --locale <locale>");
    return { kind: "add", id: templateId(id), locale: flags.locale, builtIn: flags["built-in"] === "true" };
  }
  throw new Error("Usage: screenshots template <list|add <id> --locale <locale> [--built-in]>");
}

function formatTemplate(source: "built-in" | "project", template: ScreenTemplate): string {
  return `${source} ${template.id} ${template.platform}/${template.device} ${template.targetId ?? "-"} ${template.name}`;
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
      ...templates.map((template) => formatTemplate("project", template)),
    ].join("\n");
  }
  const { screen } = action.builtIn
    ? await createBuiltInTemplateScreen(projectPath, action.id, action.locale, specs, {}, flags.layout)
    : await createTemplateScreen(projectPath, action.id, action.locale, {}, flags.layout, {}, specs);
  return `Added screen ${screen.id} (${screen.platform}/${screen.device} ${screen.locale}) from ${action.builtIn ? "built-in" : "project"} template ${action.id}`;
}
