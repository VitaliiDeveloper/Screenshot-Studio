// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  applyCaptureImport,
  CaptureImportClientError,
  previewCaptureImport,
  type CaptureImportApplyResult,
} from "@web/lib/capture-import-client";
import {
  captureImportRequest,
  reduceCaptureImportState,
  type CaptureImportAction,
  type CaptureImportCurrentTarget,
  type CaptureImportDraft,
  type CaptureImportState,
} from "@web/components/project-launcher/capture-import-model";

type ActivationFence = <T>(operation: () => Promise<T>) => Promise<T>;

export interface CaptureImportControllerOptions {
  currentTarget: CaptureImportCurrentTarget | null;
  activateNewProject?: ActivationFence;
  onCompleted(
    result: CaptureImportApplyResult,
    destinationKind: "current-project" | "new-project",
    signal: AbortSignal,
  ): void | Promise<void>;
  onRecoverStale?(): void | Promise<void>;
}

export interface CaptureImportController {
  state: CaptureImportState;
  open(): void;
  close(): void;
  selectFiles(files: readonly File[]): void;
  chooseDestination(kind: "current-project" | "new-project"): void;
  chooseCurrentLayout(layoutId: string): void;
  changeNewProject(patch: Partial<CaptureImportDraft["newProject"]>): void;
  preview(): void;
  apply(): void;
  cancel(): void;
  retry(): void;
  recoverStale(): void;
}

const directActivation: ActivationFence = (operation) => operation();

export class CaptureImportHandoffError extends Error {
  override name = "CaptureImportHandoffError";
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super("Capture import committed, but the receiving Project Home could not be verified");
    this.cause = cause;
  }
}

export function assertCaptureImportHandoff(
  result: CaptureImportApplyResult,
  activeProjectId: string | null | undefined,
): void {
  if (result.projectId !== activeProjectId) throw new CaptureImportHandoffError();
}

export function assertCaptureImportRecoveryTarget<T>(
  target: T | null | undefined,
): asserts target is T {
  if (target == null) throw new CaptureImportHandoffError();
}

export async function completeCaptureImportHandoff(
  result: CaptureImportApplyResult,
  destinationKind: "current-project" | "new-project",
  signal: AbortSignal,
  onCompleted: CaptureImportControllerOptions["onCompleted"],
): Promise<void> {
  if (signal.aborted) throw new CaptureImportHandoffError();
  try {
    await onCompleted(result, destinationKind, signal);
  } catch (error) {
    throw new CaptureImportHandoffError(error);
  }
  if (signal.aborted) throw new CaptureImportHandoffError();
}

export async function resolveCaptureImportRecovery(
  onRecoverStale: CaptureImportControllerOptions["onRecoverStale"],
): Promise<CaptureImportAction> {
  try {
    await onRecoverStale?.();
    return { type: "recovery-succeeded" };
  } catch (error) {
    return {
      type: "recovery-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isStaleCaptureImportError(error: unknown): boolean {
  return error instanceof CaptureImportHandoffError
    || (error instanceof CaptureImportClientError
      && (error.code === "preview-changed" || error.status === 409 || error.status === 412));
}

function isCancellation(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof CaptureImportClientError
      && (error.code === "cancelled" || error.status === 499));
}

export function captureImportApplyFailureAction(error: unknown): CaptureImportAction {
  return isCancellation(error)
    ? { type: "cancelled", phase: "apply" }
    : {
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
        staleTarget: true,
      };
}

export function useCaptureImportController({
  currentTarget,
  activateNewProject = directActivation,
  onCompleted,
  onRecoverStale,
}: CaptureImportControllerOptions): CaptureImportController {
  const [state, dispatch] = useReducer(reduceCaptureImportState, { status: "closed" });
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const open = useCallback(() => {
    dispatch({ type: "open", currentTarget });
  }, [currentTarget]);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const selectFiles = useCallback((files: readonly File[]) => {
    dispatch({ type: "choose-files", files });
  }, []);
  const chooseDestination = useCallback((kind: "current-project" | "new-project") => {
    dispatch({ type: "choose-destination", kind });
  }, []);
  const chooseCurrentLayout = useCallback((layoutId: string) => {
    dispatch({ type: "choose-current-layout", layoutId });
  }, []);
  const changeNewProject = useCallback((patch: Partial<CaptureImportDraft["newProject"]>) => {
    dispatch({ type: "change-new-project", patch });
  }, []);

  const preview = useCallback(() => {
    if (state.status === "closed") return;
    const request = captureImportRequest(state);
    if (!request) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "request-preview" });
    void previewCaptureImport(request, { signal: controller.signal }).then((planned) => {
      if (mountedRef.current && !controller.signal.aborted) {
        dispatch({ type: "preview-succeeded", preview: planned });
      }
    }).catch((error: unknown) => {
      if (!mountedRef.current || controllerRef.current !== controller) return;
      dispatch(isCancellation(error)
        ? { type: "cancelled", phase: "preview" }
        : {
            type: "failed",
            message: error instanceof Error ? error.message : String(error),
            staleTarget: isStaleCaptureImportError(error),
          });
    }).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  }, [state]);

  const apply = useCallback(() => {
    if (state.status !== "reviewing" || !state.preview.canApply) return;
    const request = captureImportRequest(state);
    if (!request) return;
    const destinationKind = request.destination.kind;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    dispatch({ type: "apply" });
    const operation = () => applyCaptureImport(
      request,
      state.preview.confirmationFingerprint,
      { signal: controller.signal },
    );
    const pending = destinationKind === "new-project"
      ? activateNewProject(operation)
      : operation();
    void pending.then(async (result) => {
      if (!mountedRef.current || controller.signal.aborted) return;
      await completeCaptureImportHandoff(
        result,
        destinationKind,
        controller.signal,
        onCompleted,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      dispatch({ type: "complete" });
    }).catch((error: unknown) => {
      if (!mountedRef.current || controllerRef.current !== controller) return;
      dispatch(captureImportApplyFailureAction(error));
    }).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  }, [activateNewProject, onCompleted, state]);

  const cancel = useCallback(() => {
    const phase = state.status === "applying" ? "apply"
      : state.status === "previewing" ? "preview" : null;
    if (!phase) return;
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "cancelled", phase });
  }, [state.status]);
  const retry = useCallback(() => dispatch({ type: "retry" }), []);
  const recoverStale = useCallback(() => {
    if (state.status !== "error" || !state.staleTarget || state.recovering) return;
    dispatch({ type: "request-recovery" });
    void resolveCaptureImportRecovery(onRecoverStale).then((action) => {
      if (mountedRef.current) dispatch(action);
    });
  }, [onRecoverStale, state]);

  return {
    state,
    open,
    close,
    selectFiles,
    chooseDestination,
    chooseCurrentLayout,
    changeNewProject,
    preview,
    apply,
    cancel,
    retry,
    recoverStale,
  };
}
