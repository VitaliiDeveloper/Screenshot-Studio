// SPDX-License-Identifier: Apache-2.0
import { editorStore } from "./editor-store";
import { mutateAndSave } from "./mutate-and-save";

/** Fit text as one undo step: close any open edit group first so earlier typing stays separate. */
export function applyTextFit(screenId: string, elementId: string, size: number): void {
  const store = editorStore.getState();
  mutateAndSave(() => {
    store.endHistoryGroup();
    store.patchElement({ id: elementId, screenId, type: "text", patch: { size } });
    store.endHistoryGroup();
  });
}
