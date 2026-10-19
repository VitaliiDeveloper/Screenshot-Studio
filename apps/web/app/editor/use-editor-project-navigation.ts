// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { abandonProjectSession } from "@web/lib/clients/project-close";
import {
  navigateToProjects,
  writeWorkspaceNavigationState,
  type WorkspaceNavigationState,
} from "@web/lib/editor/editor-workspace-navigation";

export function useEditorProjectNavigation(
  activeProjectId: string | null,
  workspaceNavigationState: WorkspaceNavigationState,
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);

  const openProjects = useCallback(() => {
    if (busy) return;
    if (activeProjectId) {
      writeWorkspaceNavigationState(activeProjectId, workspaceNavigationState);
    }
    setBusy(true);
    setError(null);
    void navigateToProjects({ navigate: () => router.push("/") })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
        setBusy(false);
      });
  }, [activeProjectId, busy, router, workspaceNavigationState]);

  const closeWithoutSaving = useCallback(() => {
    if (!activeProjectId || abandoning) return;
    setAbandoning(true);
    void abandonProjectSession(activeProjectId, {
      navigate: () => router.push("/?switch=1"),
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught));
      setAbandoning(false);
    });
  }, [abandoning, activeProjectId, router]);

  return {
    busy,
    error,
    abandoning,
    clearError: () => setError(null),
    openProjects,
    closeWithoutSaving,
  };
}
