// SPDX-License-Identifier: Apache-2.0
import { setCanvasMode, type CanvasMode } from "@screenshot-studio/core/model";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { loadProjectFile, updateProjectFile } from "./project-io.js";

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

export async function runCanvasCommand(
  projectPath: string,
  args: string[],
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const action = resolveCanvasAction(args);
  if (action.kind === "show") {
    return `Canvas mode: ${(await loadProjectFile(projectPath)).mode}`;
  }

  const updated = await updateProjectFile(projectPath, (project) => ({
    project: setCanvasMode(project, action.mode),
    value: undefined,
  }), lockOptions);
  return `Canvas mode: ${updated.project.mode}`;
}
