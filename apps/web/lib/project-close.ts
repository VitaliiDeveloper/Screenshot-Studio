// SPDX-License-Identifier: Apache-2.0
import {
  cancelScheduledSave,
  discardActiveProjectPersistence,
  switchActiveProject,
  withDrainedProjectSaves,
} from "./debounced-save.js";
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

/**
 * Explicitly abandon an editor session whose source can no longer be saved. This is deliberately
 * separate from the normal close flow: callers must obtain user confirmation before choosing data
 * loss, while the shared save queue still fences the server-side session handoff.
 */
export async function abandonProjectSession(
  projectId: string,
  dependencies: {
    drainSaves?: <T>(operation: () => Promise<T>) => Promise<T>;
    cancelPending?: () => void;
    requestClose?: (projectId: string) => Promise<void>;
    discardPersistence?: () => void;
    clearWorkspaceState?: (projectId: string) => void;
    navigate: () => void;
  },
): Promise<void> {
  const drainSaves = dependencies.drainSaves ?? withDrainedProjectSaves;
  const requestClose = dependencies.requestClose ?? closeActiveProject;
  (dependencies.cancelPending ?? cancelScheduledSave)();
  await drainSaves(async () => {
    await requestClose(projectId);
    (dependencies.discardPersistence ?? discardActiveProjectPersistence)();
  });
  (dependencies.clearWorkspaceState ?? clearWorkspaceNavigationState)(projectId);
  dependencies.navigate();
}
