// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import type { Project } from "@screenshot-studio/core/model";
import { useStore } from "zustand";
import { editorStore } from "@web/lib/editor/editor-store";
import {
  checkExternalProjectChange,
  EXTERNAL_CHANGE_POLL_MS,
} from "@web/lib/editor/external-project-changes";

/**
 * Picks up writes another process (the user's own agent, the CLI) made to the open project. A clean
 * editor reloads in place; an editor whose save was rejected reports a conflict for the user.
 */
export function useExternalProjectChanges(
  enabled: boolean,
  reloadExternalChange: (seen: Project | null) => Promise<boolean>,
): boolean {
  const [conflict, setConflict] = useState(false);
  const saveStatus = useStore(editorStore, (state) => state.saveStatus);
  if (conflict && (saveStatus === "idle" || saveStatus === "saved")) setConflict(false);

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const check = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const seen = editorStore.getState().project;
        const change = await checkExternalProjectChange();
        if (change === "conflict") setConflict(true);
        else if (change === "changed") await reloadExternalChange(seen);
      } finally {
        running = false;
      }
    };
    const onCheck = () => { void check(); };
    const timer = window.setInterval(onCheck, EXTERNAL_CHANGE_POLL_MS);
    window.addEventListener("focus", onCheck);
    document.addEventListener("visibilitychange", onCheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onCheck);
      document.removeEventListener("visibilitychange", onCheck);
    };
  }, [enabled, reloadExternalChange]);

  return conflict;
}
