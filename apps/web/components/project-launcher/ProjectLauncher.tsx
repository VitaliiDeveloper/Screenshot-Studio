// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectTemplateSummary } from "@screenshot-studio/core/scaffold";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  discardActiveProjectPersistence,
  switchActiveProject,
} from "@web/lib/debounced-save";
import { clearWorkspaceNavigationState } from "@web/lib/editor-workspace-navigation";
import { editorProjectUrl, projectInfoUrl } from "@web/lib/editor-route";
import { loadProjectHomeData } from "@web/lib/project-home-client";
import { downloadProjectArchive, requestProjectArchive } from "@web/lib/project-archive-client";
import { fetchActiveProject } from "@web/lib/project-session";
import {
  importProject,
  ProjectImportClientError,
  type BrowserProjectImportSource,
} from "@web/lib/project-import-client";
import { createProject } from "@web/lib/project-creation-client";
import {
  removeRecentProject,
} from "@web/lib/recent-projects-client";
import {
  fetchProjectLibrary,
  openProjectLibraryEntry,
  projectLibraryEntriesEqual,
} from "@web/lib/project-library-client";
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
import type {
  ProjectLibraryAction,
  ProjectLibraryState,
} from "./ProjectGallery";
import { ProjectDeletionDialog } from "./ProjectDeletionDialog";
import { DelayedOpeningState } from "./delayed-opening-state";
import { useManagedProjectDeletion } from "./useManagedProjectDeletion";
import {
  ProjectActionNoticeState,
  projectCardExitMs,
  projectToastVisibleMs,
  type ProjectLibraryNotice,
} from "./project-action-notice";

export function ProjectLauncher({ projectTemplates, initialProjects, storeSpecs }: {
  projectTemplates: readonly ProjectTemplateSummary[];
  initialProjects: ProjectLibraryState;
  storeSpecs: StoreSpecs;
}) {
  const router = useRouter();
  const [importState, dispatchImport] = useReducer(reduceLauncherImportState, { status: "idle" });
  const [creationState, dispatchCreation] = useReducer(
    (state, action) => reduceProjectCreationState(state, action, storeSpecs),
    initialProjectCreationState,
  );
  const [dialogClosing, setDialogClosing] = useState(false);
  const [projects, setProjects] = useState<ProjectLibraryState>(initialProjects);
  const [projectAction, setProjectAction] = useState<ProjectLibraryAction | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [projectActionNotice, setProjectActionNotice] = useState<ProjectLibraryNotice | null>(null);
  const [visibleOpeningEntryId, setVisibleOpeningEntryId] = useState<string | null>(null);
  const [leavingEntryId, setLeavingEntryId] = useState<string | null>(null);
  const [projectToast, setProjectToast] = useState<ProjectLibraryNotice | null>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const creationButtonRef = useRef<HTMLButtonElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const pendingImportSourceRef = useRef<BrowserProjectImportSource | null>(null);
  const exitActionRef = useRef<LauncherDialogExitAction>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterImportExitRef = useRef<(() => void) | null>(null);
  const creationExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const publishingRef = useRef(false);
  const openingStateRef = useRef<DelayedOpeningState | null>(null);
  const projectActionNoticeStateRef = useRef<ProjectActionNoticeState | null>(null);
  const projectToastStateRef = useRef<ProjectActionNoticeState | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusCreationWhenEmptyRef = useRef(false);
  if (openingStateRef.current == null) {
    openingStateRef.current = new DelayedOpeningState(setVisibleOpeningEntryId);
  }
  if (projectActionNoticeStateRef.current == null) {
    projectActionNoticeStateRef.current = new ProjectActionNoticeState(setProjectActionNotice);
  }
  if (projectToastStateRef.current == null) {
    projectToastStateRef.current = new ProjectActionNoticeState(setProjectToast, projectToastVisibleMs);
  }
  // Plays the card's exit animation and explains the result before the entry leaves the grid.
  const dismissEntry = (entryId: string, message: string) => {
    setLeavingEntryId(entryId);
    projectToastStateRef.current?.show(entryId, message);
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      if (!mountedRef.current) return;
      focusCreationWhenEmptyRef.current = true;
      setLeavingEntryId(null);
      setProjects((current) => current.status === "ready"
        ? { status: "ready", entries: current.entries.filter((entry) => entry.entryId !== entryId) }
        : current);
    }, projectCardExitMs);
  };
  const entryName = (entryId: string) => projects.status === "ready"
    ? projects.entries.find((entry) => entry.entryId === entryId)?.name ?? "Project"
    : "Project";
  const deletion = useManagedProjectDeletion({
    onDeleted: (projectId) => {
      discardActiveProjectPersistence();
      clearWorkspaceNavigationState(projectId);
      dismissEntry(projectId, `Deleted “${entryName(projectId)}” permanently.`);
      router.replace("/");
      router.refresh();
    },
  });
  const completeCaptureImport = useCallback(async (
    result: Parameters<typeof assertCaptureImportHandoff>[0],
    _destinationKind: "current-project" | "new-project",
    signal: AbortSignal,
  ) => {
    const activeProject = await fetchActiveProject();
    if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
    assertCaptureImportHandoff(result, activeProject?.projectId);
    router.push(editorProjectUrl(result.projectId));
    router.refresh();
  }, [router]);
  const recoverCaptureTarget = useCallback(async () => {
    const activeProject = await fetchActiveProject();
    assertCaptureImportRecoveryTarget(activeProject);
    discardActiveProjectPersistence();
    router.replace(editorProjectUrl(activeProject.projectId));
    router.refresh();
  }, [router]);
  const captureImport = useCaptureImportController({
    currentTarget: null,
    specs: storeSpecs,
    activateNewProject: switchActiveProject,
    onCompleted: completeCaptureImport,
    onRecoverStale: recoverCaptureTarget,
  });

  const settleProjects = useCallback(() => fetchActiveProject()
    .then(() => fetchProjectLibrary())
    .then((result) => {
      if (!mountedRef.current) return;
      setProjects((current) => current.status === "ready"
        && projectLibraryEntriesEqual(current.entries, result.entries)
        ? current
        : { status: "ready", entries: result.entries });
    }).catch((caught: unknown) => {
      if (mountedRef.current) setProjects({
        status: "error",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }), []);
  const loadProjects = useCallback(() => {
    setProjects({ status: "loading" });
    setProjectActionError(null);
    projectActionNoticeStateRef.current?.clear();
    void settleProjects();
  }, [settleProjects]);

  useEffect(() => {
    void settleProjects();
  }, [settleProjects]);

  useEffect(() => {
    if (!focusCreationWhenEmptyRef.current) return;
    focusCreationWhenEmptyRef.current = false;
    // The last card is gone, so the first-run layout replaced the gallery; land on its main action.
    if (projects.status === "ready" && projects.entries.length === 0
      && (!document.activeElement || document.activeElement === document.body)) {
      creationButtonRef.current?.focus();
    }
  }, [projects]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      projectToastStateRef.current?.dispose();
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      if (creationExitTimerRef.current) clearTimeout(creationExitTimerRef.current);
      openingStateRef.current?.clear();
      projectActionNoticeStateRef.current?.dispose();
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
      const afterExit = afterImportExitRef.current;
      afterImportExitRef.current = null;
      if (afterExit) afterExit();
      else returnFocus();
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = launcherDialogExitDelay(reducedMotion);
    if (delay === 0) finishExit();
    else exitTimerRef.current = setTimeout(finishExit, delay);
  };
  const closeImport = () => requestImportExit("close");
  const cancelImport = () => requestImportExit("cancel");
  const chooseCaptureImport = () => {
    afterImportExitRef.current = captureImport.open;
    requestImportExit("close");
  };
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
    })).then((result) => {
      if (!mountedRef.current) return;
      dispatchImport({ type: "complete" });
      router.push(editorProjectUrl(result.projectId));
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
          router.push(editorProjectUrl(result.projectId));
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
  const openProject = (entryId: string, destination: "workspace" | "details") => {
    if (projectAction) return;
    setProjectAction({ entryId, kind: destination === "workspace" ? "opening" : "details" });
    if (destination === "workspace") openingStateRef.current?.start(entryId);
    setProjectActionError(null);
    projectActionNoticeStateRef.current?.clear();
    void switchActiveProject(() => openProjectLibraryEntry(entryId)).then((result) => {
      if (!mountedRef.current) return;
      router.push(destination === "workspace"
        ? editorProjectUrl(entryId)
        : projectInfoUrl(result.projectId, entryId));
    }).catch((caught: unknown) => {
      if (mountedRef.current) setProjectActionError(
        caught instanceof Error ? caught.message : String(caught),
      );
    }).finally(() => {
      openingStateRef.current?.clear();
      if (mountedRef.current) setProjectAction(null);
    });
  };
  const loadManagedProjectAction = async (entryId: string) => {
    const opened = await switchActiveProject(() => openProjectLibraryEntry(entryId));
    const loaded = await loadProjectHomeData();
    if (!loaded || loaded.selection.projectId !== opened.projectId) {
      throw new Error("The active project changed before the requested action could start.");
    }
    return loaded;
  };
  const runManagedProjectAction = (entryId: string, kind: "archive" | "deleting") => {
    if (projectAction || leavingEntryId) return;
    setProjectAction({ entryId, kind });
    setProjectActionError(null);
    projectActionNoticeStateRef.current?.clear();
    void loadManagedProjectAction(entryId).then(async (loaded) => {
      if (kind === "archive") {
        downloadProjectArchive(await requestProjectArchive(loaded.selection.projectId, loaded.resources.revision));
        if (mountedRef.current) {
          projectActionNoticeStateRef.current?.show(entryId, "Archive download started.");
        }
      } else {
        deletion.open(loaded);
      }
    }).catch((caught: unknown) => {
      if (mountedRef.current) setProjectActionError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (mountedRef.current) setProjectAction(null);
    });
  };
  const removeRecent = (recentId: string) => {
    if (projectAction || leavingEntryId) return;
    setProjectAction({ entryId: recentId, kind: "removing" });
    setProjectActionError(null);
    projectActionNoticeStateRef.current?.clear();
    const name = entryName(recentId);
    void removeRecentProject(recentId).then(() => {
      if (!mountedRef.current) return;
      // Re-enable the other cards in the same render so focus can move to one of them.
      setProjectAction(null);
      dismissEntry(recentId, `Removed “${name}” from recents. Project files are untouched.`);
    }).catch((caught: unknown) => {
      if (mountedRef.current) setProjectActionError(
        caught instanceof Error ? caught.message : String(caught),
      );
    }).finally(() => {
      if (mountedRef.current) setProjectAction(null);
    });
  };

  return (
    <AppHomeShell
      state={importState}
      creationState={creationState}
      projectTemplates={projectTemplates}
      storeSpecs={storeSpecs}
      dialogClosing={dialogClosing}
      projects={projects}
      projectAction={projectAction}
      projectActionError={projectActionError}
      projectActionNotice={projectActionNotice}
      projectToast={projectToast}
      leavingEntryId={leavingEntryId}
      visibleOpeningEntryId={visibleOpeningEntryId}
      deletionDialog={deletion.dialog && deletion.projectName ? <ProjectDeletionDialog projectName={deletion.projectName} state={deletion.dialog} confirmation={deletion.confirmation} acknowledged={deletion.acknowledged} onConfirmationChange={deletion.setConfirmation} onAcknowledgedChange={deletion.setAcknowledged} onExportArchive={() => { void deletion.exportArchive(); }} onContinueWithoutArchive={deletion.continueWithoutArchive} onConfirmDelete={() => { void deletion.confirm(); }} onRetryDeletion={() => { void deletion.retry(); }} onClose={deletion.close} /> : null}
      importButtonRef={importButtonRef}
      creationButtonRef={creationButtonRef}
      captureDialog={captureImport.state.status === "closed" ? null : (
        <CaptureImportDialog
          state={captureImport.state}
          specs={storeSpecs}
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
      onCloseImport={closeImport}
      onCancelImport={cancelImport}
      onConfirmImport={confirmImport}
      onRetryImport={() => {
        pendingImportSourceRef.current = null;
        dispatchImport({ type: "retry" });
      }}
      onSelectSource={selectSource}
      onChooseCapture={chooseCaptureImport}
      onRetryProjects={loadProjects}
      onOpenProject={(entryId) => openProject(entryId, "workspace")}
      onOpenProjectDetails={(entryId) => openProject(entryId, "details")}
      onExportArchive={(entryId) => runManagedProjectAction(entryId, "archive")}
      onDeleteProject={(entryId) => runManagedProjectAction(entryId, "deleting")}
      onRemoveRecent={removeRecent}
    />
  );
}
