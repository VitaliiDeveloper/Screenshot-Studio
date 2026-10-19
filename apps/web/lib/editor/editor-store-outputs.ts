// SPDX-License-Identifier: Apache-2.0
import type { ScreenSetMode } from "@screenshot-studio/core/model";
import type { StoreSize } from "@screenshot-studio/core/export";
import { recordProjectChange } from "./editor-history.js";
import {
  changeOutputFamilyScreenSetMode,
  createStoreOutputFamily,
  createStoreTargetVariant,
  deleteStoreOutputFamily,
  deleteStoreTargetVariant,
} from "./editor-project-actions.js";
import type { EditorSet } from "./editor-store.js";

export interface EditorOutputActions {
  ensureStoreOutputFamily: (platform: string, device: string, leadTarget: StoreSize) => void;
  removeStoreOutputFamily: (sourceScreenId: string) => void;
  ensureStoreTargetVariant: (target: StoreSize) => void;
  removeStoreTargetVariant: (rootScreenId: string, storeTargetId: string) => void;
  setOutputFamilyScreenSetMode: (mode: ScreenSetMode) => void;
}

export function createEditorOutputActions(set: EditorSet): EditorOutputActions {
  return {
    ensureStoreOutputFamily: (platform, device, leadTarget) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        const result = createStoreOutputFamily(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          platform,
          device,
          leadTarget,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    removeStoreOutputFamily: (sourceScreenId) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = deleteStoreOutputFamily(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          state.selectedItems,
          sourceScreenId,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    ensureStoreTargetVariant: (target) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        const result = createStoreTargetVariant(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          target,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    removeStoreTargetVariant: (rootScreenId, storeTargetId) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = deleteStoreTargetVariant(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          state.selectedItems,
          rootScreenId,
          storeTargetId,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    setOutputFamilyScreenSetMode: (mode) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        const result = changeOutputFamilyScreenSetMode(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          mode,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
  };
}
