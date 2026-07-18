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
import { reduceLauncherImportState } from "./project-launcher-model";

export function ProjectLauncher({ allowSwitch }: { allowSwitch: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [importState, dispatchImport] = useReducer(reduceLauncherImportState, { status: "idle" });
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const pendingImportSourceRef = useRef<BrowserProjectImportSource | null>(null);

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

  useEffect(() => () => importControllerRef.current?.abort(), []);

  const returnFocus = () => queueMicrotask(() => importButtonRef.current?.focus());
  const closeImport = () => {
    pendingImportSourceRef.current = null;
    dispatchImport({ type: "close" });
    returnFocus();
  };
  const cancelImport = () => {
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    pendingImportSourceRef.current = null;
    dispatchImport({ type: "cancel" });
    returnFocus();
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
    importControllerRef.current?.abort();
    importControllerRef.current = controller;
    dispatchImport({ type: "confirm" });
    void importProject(source, {
      signal: controller.signal,
      onUploadComplete: () => dispatchImport({ type: "publishing" }),
    }).then(() => {
      dispatchImport({ type: "complete" });
      router.push("/home");
      router.refresh();
    }).catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        dispatchImport({ type: "cancel" });
        return;
      }
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
