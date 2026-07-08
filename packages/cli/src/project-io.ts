import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseProjectJson, Project, type Project as ProjectModel } from "@screenshot-studio/core/model";

export function resolveProjectPath(flags: Record<string, string>): string {
  return resolve(flags.project ?? "app-store-screenshots.json");
}

export async function loadProjectFile(projectPath: string): Promise<ProjectModel> {
  return parseProjectJson(await readFile(projectPath, "utf8"));
}

export async function writeProjectFile(projectPath: string, project: ProjectModel): Promise<void> {
  const validated = Project.parse(project);
  await writeFile(projectPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
