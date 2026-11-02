// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  assertCaptureImportHandoff,
  useCaptureImportController,
} from "@web/components/project-launcher/useCaptureImportController";
import { switchActiveProject, withFlushedProject } from "@web/lib/editor/debounced-save";
import { editorProjectUrl } from "@web/lib/editor/editor-route";
import { fetchActiveProject } from "@web/lib/clients/project-session";
import { getProjectPersistenceIdentity } from "@web/lib/clients/save-project";

export function useEditorCaptureImport(
  project: Project | null,
  activeProjectId: string | null,
  reloadResources: () => Promise<boolean>,
  reloadFromDisk: () => Promise<boolean>,
  specs: StoreSpecs | null,
) {
  const router = useRouter();
  const persistedProjectId = getProjectPersistenceIdentity()?.projectId;
  const currentTarget = useMemo(() => project && activeProjectId
    && persistedProjectId === activeProjectId
    ? {
        projectName: project.meta.name,
        preferredLayoutId: project.preferredExportLayoutId,
        layouts: project.layouts.map(({ id, name }) => ({ id, name })),
      }
    : null, [activeProjectId, persistedProjectId, project]);

  const complete = useCallback(async (
    result: Parameters<typeof assertCaptureImportHandoff>[0],
    destinationKind: "current-project" | "new-project",
    signal: AbortSignal,
  ) => {
    if (destinationKind === "new-project") {
      const activeProject = await fetchActiveProject();
      if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
      assertCaptureImportHandoff(result, activeProject?.projectId);
      router.replace(editorProjectUrl(result.projectId));
      return;
    }
    // The apply saved every edit first and advanced the revision, so the pre-import copy is not saved again.
    const reloaded = await reloadFromDisk();
    if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
    if (!reloaded) throw new Error("Capture import completed, but the editor could not reload it");
    assertCaptureImportHandoff(result, getProjectPersistenceIdentity()?.projectId);
  }, [reloadFromDisk, router]);

  const recover = useCallback(async () => {
    const reloaded = await reloadResources();
    if (!reloaded) throw new Error("The current project could not be reloaded");
  }, [reloadResources]);

  return useCaptureImportController({
    currentTarget,
    ...(specs ? { specs } : {}),
    activateNewProject: switchActiveProject,
    applyToCurrentProject: withFlushedProject,
    onCompleted: complete,
    onRecoverStale: recover,
  });
}
