// SPDX-License-Identifier: Apache-2.0
import { switchActiveProject } from "./debounced-save.js";
import { clearWorkspaceNavigationState } from "./editor-workspace-navigation.js";
import { closeActiveProject } from "./project-session.js";

type ProjectSwitch = (activate: () => Promise<void>) => Promise<void>;

export async function closeProjectSession(
  projectId: string,
  dependencies: {
    switchProject?: ProjectSwitch;
    requestClose?: (projectId: string) => Promise<void>;
    clearWorkspaceState?: (projectId: string) => void;
    navigate: () => void;
  },
): Promise<void> {
  const switchProject = dependencies.switchProject ?? switchActiveProject;
  const requestClose = dependencies.requestClose ?? closeActiveProject;
  await switchProject(() => requestClose(projectId));
  (dependencies.clearWorkspaceState ?? clearWorkspaceNavigationState)(projectId);
  dependencies.navigate();
}
