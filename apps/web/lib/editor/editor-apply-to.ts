// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";
import type { ApplyScope } from "./editor-apply-scope";
import { editorStore, type PatchElementRequest } from "./editor-store";
import { mutateAndSave } from "./mutate-and-save";

/**
 * Apply to… as a discrete action (canvas selection toolbar, pickers): one layer edit written to
 * every screen in `scope` as its own undo step and saved at once. Continuous inspector input calls
 * `patchElement` with a scope instead, so typing stays one step.
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
