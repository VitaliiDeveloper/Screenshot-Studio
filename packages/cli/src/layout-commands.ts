// SPDX-License-Identifier: Apache-2.0
import {
  addLayout,
  duplicateLayout,
  getPreferredExportLayout,
  preferLayout,
  removeLayout,
  renameLayout,
  resolveLayoutReference,
  setLayoutMode,
  type CanvasMode,
  type DesignLayout,
  type Project,
} from "@screenshot-studio/core/model";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { loadProjectFile, updateProjectFile } from "./project-io.js";

export type LayoutAction =
  | { kind: "list" }
  | { kind: "add"; name: string; mode: CanvasMode }
  | { kind: "duplicate"; reference: string; name?: string }
  | { kind: "rename"; reference: string; name: string }
  | { kind: "mode"; reference: string; mode: CanvasMode }
  | { kind: "prefer"; reference: string }
  | { kind: "rm"; reference: string };

export function resolveLayoutAction(args: string[], flags: Record<string, string>): LayoutAction {
  const [subcommand, reference, extra] = args;
  switch (subcommand) {
    case "list":
      if (reference) throw new Error("Usage: screenshots layout list");
      return { kind: "list" };
    case "add": {
      if (!reference || extra) throw new Error('Usage: screenshots layout add "Name" --mode <isolated|connected>');
      const mode = flags.mode;
      if (!mode) throw new Error("layout add requires --mode");
      if (mode !== "isolated" && mode !== "connected") {
        throw new Error("Layout mode must be isolated or connected");
      }
      return { kind: "add", name: reference, mode };
    }
    case "duplicate":
      if (!reference || extra) throw new Error('Usage: screenshots layout duplicate <id-or-name> [--name "Copy"]');
      return {
        kind: "duplicate",
        reference,
        ...(flags.name ? { name: flags.name } : {}),
      };
    case "rename":
      if (!reference || !extra) throw new Error('Usage: screenshots layout rename <id-or-name> "New name"');
      return { kind: "rename", reference, name: extra };
    case "mode": {
      if (!reference || extra) throw new Error("Usage: screenshots layout mode <id-or-name> --mode <isolated|connected>");
      const mode = flags.mode;
      if (!mode) throw new Error("layout mode requires --mode");
      if (mode !== "isolated" && mode !== "connected") {
        throw new Error("Layout mode must be isolated or connected");
      }
      return { kind: "mode", reference, mode };
    }
    case "prefer":
      if (!reference || extra) throw new Error("Usage: screenshots layout prefer <id-or-name>");
      return { kind: "prefer", reference };
    case "rm":
      if (!reference || extra) throw new Error("Usage: screenshots layout rm <id-or-name>");
      return { kind: "rm", reference };
    default:
      throw new Error("Usage: screenshots layout <list|add|duplicate|rename|mode|prefer|rm>");
  }
}

export function formatLayoutList(project: Project): string {
  return project.layouts.map((layout, index) => {
    const preferred = layout.id === project.preferredExportLayoutId ? " preferred" : "";
    return `${index + 1} ${layout.id} ${layout.name} mode=${layout.mode}${preferred}`;
  }).join("\n");
}

export function resolveMutationLayout(project: Project, reference?: string): DesignLayout {
  if (reference) return resolveLayoutReference(project, reference);
  if (project.layouts.length === 1) return project.layouts[0]!;
  throw new Error("This project has multiple layouts; pass --layout <id-or-name>");
}

export async function runLayoutCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const action = resolveLayoutAction(args, flags);
  if (action.kind === "list") return formatLayoutList(await loadProjectFile(projectPath));

  const updated = await updateProjectFile(projectPath, (project) => {
    if (action.kind === "add") {
      const source = getPreferredExportLayout(project).screens.find((screen) => screen.variantOf === undefined)
        ?? getPreferredExportLayout(project).screens[0]!;
      return {
        project: addLayout(project, {
          name: action.name,
          mode: action.mode,
          screen: {
            platform: source.platform,
            device: source.device,
            locale: source.locale,
            direction: source.direction,
            artboard: source.artboard,
          },
        }).project,
        value: undefined,
      };
    }
    if (action.kind === "duplicate") {
      return {
        project: duplicateLayout(project, action.reference, action.name).project,
        value: undefined,
      };
    }
    if (action.kind === "rename") {
      return { project: renameLayout(project, action.reference, action.name), value: undefined };
    }
    if (action.kind === "mode") {
      return { project: setLayoutMode(project, action.reference, action.mode), value: undefined };
    }
    if (action.kind === "prefer") {
      return { project: preferLayout(project, action.reference), value: undefined };
    }
    return { project: removeLayout(project, action.reference).project, value: undefined };
  }, lockOptions);
  return formatLayoutList(updated.project);
}
