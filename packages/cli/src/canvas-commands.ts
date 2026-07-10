// SPDX-License-Identifier: Apache-2.0
import { setCanvasMode, type CanvasMode } from "@screenshot-studio/core/model";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

export type CanvasAction = { kind: "show" } | { kind: "set"; mode: CanvasMode };

export function resolveCanvasAction(args: string[]): CanvasAction {
  const [subcommand, value, extra] = args;
  if (subcommand !== "mode" || extra) {
    throw new Error("Usage: screenshots canvas mode [isolated|connected]");
  }
  if (!value) return { kind: "show" };
  if (value !== "isolated" && value !== "connected") {
    throw new Error("Canvas mode must be isolated or connected");
  }
  return { kind: "set", mode: value };
}

export async function runCanvasCommand(projectPath: string, args: string[]): Promise<string> {
  const action = resolveCanvasAction(args);
  const project = await loadProjectFile(projectPath);
  if (action.kind === "show") return `Canvas mode: ${project.mode}`;

  const nextProject = setCanvasMode(project, action.mode);
  if (nextProject !== project) await writeProjectFile(projectPath, nextProject);
  return `Canvas mode: ${nextProject.mode}`;
}
