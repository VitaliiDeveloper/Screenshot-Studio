// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";
import type { ApplyScope } from "./editor-apply-scope";
import { editorStore, type PatchElementRequest } from "./editor-store";
import { mutateAndSave } from "./mutate-and-save";

/**
 * A discrete layer edit (canvas gesture, inline text, layer row, picker): written to every screen
 * in `scope` as its own undo step and saved at once. Continuous input calls `patchElement` instead,
 * so typing in one field stays one step.
 */
export function applyElementPatchToScope<T extends Element["type"]>(
  request: PatchElementRequest<T> & { scope: ApplyScope },
): void {
  const store = editorStore.getState();
  mutateAndSave(() => {
    store.endHistoryGroup();
    store.patchElement(request);
    store.endHistoryGroup();
  });
}
