// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect } from "react";
import type { EditorState } from "@web/lib/editor-store";
import {
  flushScheduledSave,
  hasPendingProjectSave,
} from "@web/lib/debounced-save";

export function useEditorSaveGuards(saveStatus: EditorState["saveStatus"]): void {
  useEffect(() => {
    const onPageHide = () => { void flushScheduledSave().catch(() => undefined); };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingProjectSave() && saveStatus !== "saving" && saveStatus !== "error") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus]);
}
