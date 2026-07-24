// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@screenshot-studio/core/model";
import {
  assertCaptureImportHandoff,
  useCaptureImportController,
} from "@web/components/project-launcher/useCaptureImportController";
import { discardActiveProjectPersistence } from "@web/lib/debounced-save";
import { editorProjectUrl } from "@web/lib/editor-route";
import { fetchActiveProject } from "@web/lib/project-session";
import { getProjectPersistenceIdentity } from "@web/lib/save-project";

export function useEditorCaptureImport(
  project: Project | null,
  activeProjectId: string | null,
  reloadResources: () => Promise<boolean>,
) {
  const router = useRouter();
  const persistence = getProjectPersistenceIdentity();
  const currentTarget = useMemo(() => project && activeProjectId
    && persistence?.projectId === activeProjectId
    ? {
        projectId: persistence.projectId,
        revision: persistence.revision,
        projectName: project.meta.name,
        preferredLayoutId: project.preferredExportLayoutId,
        layouts: project.layouts.map(({ id, name }) => ({ id, name })),
      }
    : null, [activeProjectId, persistence?.projectId, persistence?.revision, project]);

  const complete = useCallback(async (
    result: Parameters<typeof assertCaptureImportHandoff>[0],
    destinationKind: "current-project" | "new-project",
    signal: AbortSignal,
  ) => {
    if (destinationKind === "new-project") {
      const activeProject = await fetchActiveProject();
      if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
      assertCaptureImportHandoff(result, activeProject?.projectId);
      discardActiveProjectPersistence();
      router.replace(editorProjectUrl(result.projectId));
      return;
    }
    const reloaded = await reloadResources();
    if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
    if (!reloaded) throw new Error("Capture import completed, but the editor could not reload it");
    assertCaptureImportHandoff(result, getProjectPersistenceIdentity()?.projectId);
  }, [reloadResources, router]);

  const recover = useCallback(async () => {
    const reloaded = await reloadResources();
    if (!reloaded) throw new Error("The current project could not be reloaded");
  }, [reloadResources]);

  return useCaptureImportController({
    currentTarget,
    onCompleted: complete,
    onRecoverStale: recover,
  });
}
