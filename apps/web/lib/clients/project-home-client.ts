// SPDX-License-Identifier: Apache-2.0
import { loadEditorResources, type EditorResourceResult } from "@web/app/editor/editor-resources.js";
import { fetchActiveProject, type ActiveProjectSelection } from "./project-session.js";

export interface ProjectHomeData {
  selection: ActiveProjectSelection;
  resources: EditorResourceResult;
}

export async function loadProjectHomeData(dependencies: {
  fetchSelection?: () => Promise<ActiveProjectSelection | null>;
  loadResources?: () => Promise<EditorResourceResult>;
} = {}): Promise<ProjectHomeData | null> {
  const selection = await (dependencies.fetchSelection ?? fetchActiveProject)();
  if (!selection) return null;
  const resources = await (dependencies.loadResources ?? loadEditorResources)();
  if (resources.projectId !== selection.projectId) {
    throw new Error("Active project changed while Project Home was loading");
  }
  return { selection, resources };
}
