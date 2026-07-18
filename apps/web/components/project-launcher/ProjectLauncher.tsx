// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchActiveProject } from "../../lib/project-session";
import {
  importProject,
  ProjectImportClientError,
  type BrowserProjectImportSource,
} from "../../lib/project-import-client";
import { AppHomeShell } from "./AppHomeShell";
import {
  launcherDialogExitDelay,
  requestLauncherDialogExit,
  type LauncherDialogExitAction,
} from "./project-dialog-motion";
import { reduceLauncherImportState } from "./project-launcher-model";

export function ProjectLauncher({ allowSwitch }: { allowSwitch: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [importState, dispatchImport] = useReducer(reduceLauncherImportState, { status: "idle" });
  const [dialogClosing, setDialogClosing] = useState(false);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const pendingImportSourceRef = useRef<BrowserProjectImportSource | null>(null);
  const exitActionRef = useRef<LauncherDialogExitAction>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const publishingRef = useRef(false);

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
    void importProject(source, {
      signal: controller.signal,
      onUploadComplete: () => {
        if (!mountedRef.current || exitActionRef.current === "cancel") return;
        publishingRef.current = true;
        dispatchImport({ type: "publishing" });
      },
    }).then(() => {
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

  return (
    <AppHomeShell
      state={importState}
      dialogClosing={dialogClosing}
      sessionError={error}
      importButtonRef={importButtonRef}
      onOpenImport={() => dispatchImport({ type: "choose" })}
      onCloseImport={closeImport}
      onCancelImport={cancelImport}
      onConfirmImport={confirmImport}
      onRetryImport={() => {
        pendingImportSourceRef.current = null;
        dispatchImport({ type: "retry" });
      }}
      onSelectSource={selectSource}
    />
  );
}
