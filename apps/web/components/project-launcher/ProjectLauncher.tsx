// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectTemplateSummary } from "@screenshot-studio/core/scaffold";
import {
  discardActiveProjectPersistence,
  switchActiveProject,
} from "../../lib/debounced-save";
import { fetchActiveProject } from "../../lib/project-session";
import {
  importProject,
  ProjectImportClientError,
  type BrowserProjectImportSource,
} from "../../lib/project-import-client";
import { createProject } from "../../lib/project-creation-client";
import {
  fetchRecentProjects,
  openRecentProject,
  removeRecentProject,
} from "../../lib/recent-projects-client";
import { AppHomeShell } from "./AppHomeShell";
import { CaptureImportDialog } from "./CaptureImportDialog";
import {
  assertCaptureImportHandoff,
  assertCaptureImportRecoveryTarget,
  useCaptureImportController,
} from "./useCaptureImportController";
import {
  launcherDialogExitDelay,
  requestLauncherDialogExit,
  type LauncherDialogExitAction,
} from "./project-dialog-motion";
import { reduceLauncherImportState } from "./project-launcher-model";
import {
  initialProjectCreationState,
  reduceProjectCreationState,
  type ProjectCreationForm,
} from "./project-creation-model";
import type { LauncherExampleWorkflow } from "./launcher-examples";
import type {
  RecentProjectAction,
  RecentProjectsPanelState,
} from "./RecentProjectsPanel";

export function ProjectLauncher({
  allowSwitch,
  projectTemplates,
}: {
  allowSwitch: boolean;
  projectTemplates: readonly ProjectTemplateSummary[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [importState, dispatchImport] = useReducer(reduceLauncherImportState, { status: "idle" });
  const [creationState, dispatchCreation] = useReducer(
    reduceProjectCreationState,
    initialProjectCreationState,
  );
  const [dialogClosing, setDialogClosing] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectsPanelState>({ status: "loading" });
  const [recentAction, setRecentAction] = useState<RecentProjectAction | null>(null);
  const [recentActionError, setRecentActionError] = useState<string | null>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const creationButtonRef = useRef<HTMLButtonElement>(null);
  const recentHeadingRef = useRef<HTMLHeadingElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const pendingImportSourceRef = useRef<BrowserProjectImportSource | null>(null);
  const exitActionRef = useRef<LauncherDialogExitAction>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creationExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const publishingRef = useRef(false);
  const completeCaptureImport = useCallback(async (
    result: Parameters<typeof assertCaptureImportHandoff>[0],
    _destinationKind: "current-project" | "new-project",
    signal: AbortSignal,
  ) => {
    const activeProject = await fetchActiveProject();
    if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
    assertCaptureImportHandoff(result, activeProject?.projectId);
    router.push(`/home?project=${encodeURIComponent(result.projectId)}`);
    router.refresh();
  }, [router]);
  const recoverCaptureTarget = useCallback(async () => {
    const activeProject = await fetchActiveProject();
    assertCaptureImportRecoveryTarget(activeProject);
    discardActiveProjectPersistence();
    router.replace("/home");
    router.refresh();
  }, [router]);
  const captureImport = useCaptureImportController({
    currentTarget: null,
    activateNewProject: switchActiveProject,
    onCompleted: completeCaptureImport,
    onRecoverStale: recoverCaptureTarget,
  });

  const settleRecentProjects = useCallback(() => fetchRecentProjects().then((result) => {
    if (mountedRef.current) setRecentProjects({ status: "ready", entries: result.entries });
  }).catch((caught: unknown) => {
    if (mountedRef.current) setRecentProjects({
      status: "error",
      message: caught instanceof Error ? caught.message : String(caught),
    });
  }), []);
  const loadRecentProjects = useCallback(() => {
    setRecentProjects({ status: "loading" });
    setRecentActionError(null);
    void settleRecentProjects();
  }, [settleRecentProjects]);

  useEffect(() => {
    void settleRecentProjects();
  }, [settleRecentProjects]);

  useEffect(() => {
    if (allowSwitch) return;
    let active = true;
    void fetchActiveProject().then((project) => {
      if (active && project) router.replace("/home");
    }).catch((caught: unknown) => {
      if (active) setError((caught as Error).message);
    });
    return () => { active = false; };
  }, [allowSwitch, router]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      if (creationExitTimerRef.current) clearTimeout(creationExitTimerRef.current);
      importControllerRef.current?.abort();
    };
  }, []);

  const returnFocus = () => queueMicrotask(() => importButtonRef.current?.focus());
  const requestImportExit = (requested: Exclude<LauncherDialogExitAction, null>) => {
    const action = requestLauncherDialogExit(
      exitActionRef.current,
      requested,
      publishingRef.current || importState.status === "publishing",
    );
    if (!action || exitActionRef.current) return;

    exitActionRef.current = action;
    setDialogClosing(true);
    if (action === "cancel") {
      importControllerRef.current?.abort();
      importControllerRef.current = null;
    }

    const finishExit = () => {
      if (!mountedRef.current) return;
      pendingImportSourceRef.current = null;
      dispatchImport({ type: action });
      exitActionRef.current = null;
      exitTimerRef.current = null;
      setDialogClosing(false);
      returnFocus();
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = launcherDialogExitDelay(reducedMotion);
    if (delay === 0) finishExit();
    else exitTimerRef.current = setTimeout(finishExit, delay);
  };
  const closeImport = () => requestImportExit("close");
  const cancelImport = () => requestImportExit("cancel");
  const selectSource = (source: BrowserProjectImportSource) => {
    pendingImportSourceRef.current = source;
    dispatchImport({ type: "select", kind: source.kind });
  };
  const confirmImport = () => {
    const source = pendingImportSourceRef.current;
    if (!source) {
      dispatchImport({ type: "retry" });
      return;
    }
    pendingImportSourceRef.current = null;
    const controller = new AbortController();
    publishingRef.current = false;
    importControllerRef.current?.abort();
    importControllerRef.current = controller;
    dispatchImport({ type: "confirm" });
    void switchActiveProject(() => importProject(source, {
      signal: controller.signal,
      onUploadComplete: () => {
        if (!mountedRef.current || exitActionRef.current === "cancel") return;
        publishingRef.current = true;
        dispatchImport({ type: "publishing" });
      },
    })).then(() => {
      if (!mountedRef.current) return;
      dispatchImport({ type: "complete" });
      router.push("/home");
      router.refresh();
    }).catch((caught: unknown) => {
      publishingRef.current = false;
      if (caught instanceof DOMException && caught.name === "AbortError") {
        if (mountedRef.current && exitActionRef.current !== "cancel") {
          dispatchImport({ type: "cancel" });
        }
        return;
      }
      if (!mountedRef.current) return;
      dispatchImport({
        type: "fail",
        message: caught instanceof Error ? caught.message : String(caught),
        missingResources: caught instanceof ProjectImportClientError
          ? caught.missingResources
          : [],
      });
    }).finally(() => {
      if (importControllerRef.current === controller) importControllerRef.current = null;
    });
  };
  const closeCreation = useCallback(() => {
    if (creationState.status === "creating" || creationState.status === "completing") return;
    dispatchCreation({ type: "close" });
    queueMicrotask(() => creationButtonRef.current?.focus());
  }, [creationState.status]);
  const changeCreation = useCallback((patch: Partial<ProjectCreationForm>) => {
    dispatchCreation({ type: "change", patch });
  }, []);
  const submitCreation = () => {
    if (creationState.status !== "editing" && creationState.status !== "error") return;
    const input = creationState.form;
    dispatchCreation({ type: "submit" });
    void switchActiveProject(() => createProject(input)).then((result) => {
      if (!mountedRef.current) return;
      dispatchCreation({ type: "complete", projectId: result.projectId });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const navigate = () => {
        creationExitTimerRef.current = null;
        if (mountedRef.current) {
          router.push(`/home?project=${encodeURIComponent(result.projectId)}`);
        }
      };
      const delay = launcherDialogExitDelay(reducedMotion);
      if (delay === 0) navigate();
      else creationExitTimerRef.current = setTimeout(navigate, delay);
    }).catch((caught: unknown) => {
      if (!mountedRef.current) return;
      dispatchCreation({
        type: "fail",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    });
  };
  const openRecent = (recentId: string) => {
    if (recentAction) return;
    setRecentAction({ recentId, kind: "opening" });
    setRecentActionError(null);
    void switchActiveProject(() => openRecentProject(recentId)).then((result) => {
      if (!mountedRef.current) return;
      router.push(`/home?project=${encodeURIComponent(result.projectId)}`);
    }).catch((caught: unknown) => {
      if (mountedRef.current) setRecentActionError(
        caught instanceof Error ? caught.message : String(caught),
      );
    }).finally(() => {
      if (mountedRef.current) setRecentAction(null);
    });
  };
  const removeRecent = (recentId: string) => {
    if (recentAction) return;
    setRecentAction({ recentId, kind: "removing" });
    setRecentActionError(null);
    void removeRecentProject(recentId).then(() => {
      if (!mountedRef.current) return;
      setRecentProjects((current) => current.status === "ready"
        ? { status: "ready", entries: current.entries.filter((entry) => entry.recentId !== recentId) }
        : current);
      queueMicrotask(() => recentHeadingRef.current?.focus());
    }).catch((caught: unknown) => {
      if (mountedRef.current) setRecentActionError(
        caught instanceof Error ? caught.message : String(caught),
      );
    }).finally(() => {
      if (mountedRef.current) setRecentAction(null);
    });
  };
  const selectExample = (example: LauncherExampleWorkflow) => {
    if (example.action === "create-project") {
      dispatchCreation({ type: "open", form: { name: example.title, ...example.creation } });
      return;
    }
    if (example.action === "project-import") {
      dispatchImport({ type: "choose" });
      return;
    }
    captureImport.open();
  };

  return (
    <AppHomeShell
      state={importState}
      creationState={creationState}
      projectTemplates={projectTemplates}
      dialogClosing={dialogClosing}
      sessionError={error}
      recentProjects={recentProjects}
      recentAction={recentAction}
      recentActionError={recentActionError}
      importButtonRef={importButtonRef}
      creationButtonRef={creationButtonRef}
      recentHeadingRef={recentHeadingRef}
      captureDialog={captureImport.state.status === "closed" ? null : (
        <CaptureImportDialog
          state={captureImport.state}
          onClose={captureImport.close}
          onSelectFiles={captureImport.selectFiles}
          onChooseDestination={captureImport.chooseDestination}
          onChooseCurrentLayout={captureImport.chooseCurrentLayout}
          onChangeNewProject={captureImport.changeNewProject}
          onPreview={captureImport.preview}
          onApply={captureImport.apply}
          onCancel={captureImport.cancel}
          onRetry={captureImport.retry}
          onRecoverStale={captureImport.recoverStale}
        />
      )}
      onOpenCreate={() => dispatchCreation({ type: "open" })}
      onCloseCreate={closeCreation}
      onChangeCreation={changeCreation}
      onSubmitCreation={submitCreation}
      onOpenImport={() => dispatchImport({ type: "choose" })}
      onOpenCapture={captureImport.open}
      onCloseImport={closeImport}
      onCancelImport={cancelImport}
      onConfirmImport={confirmImport}
      onRetryImport={() => {
        pendingImportSourceRef.current = null;
        dispatchImport({ type: "retry" });
      }}
      onSelectSource={selectSource}
      onRetryRecents={loadRecentProjects}
      onOpenRecent={openRecent}
      onRemoveRecent={removeRecent}
      onSelectExample={selectExample}
    />
  );
}
