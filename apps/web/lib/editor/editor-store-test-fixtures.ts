// SPDX-License-Identifier: Apache-2.0
import { editorStore } from "./editor-store.js";
import type {
  ElementPatchFor,
  Project,
} from "@screenshot-studio/core/model";

export function patchText(id: string, patch: ElementPatchFor<"text">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "text", patch, screenId });
}

export function patchShape(id: string, patch: ElementPatchFor<"shape">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "shape", patch, screenId });
}

export function patchImage(id: string, patch: ElementPatchFor<"image">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "image", patch, screenId });
}

export function patchIcon(id: string, patch: ElementPatchFor<"icon">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "icon", patch, screenId });
}

export function patchGroup(id: string, patch: ElementPatchFor<"group">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "group", patch, screenId });
}

export function project(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [{
          id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
          rotation: 0, opacity: 1, locked: false, visible: true,
          content: "Hello", fontFamily: "Pacifico", size: 72, weight: 400,
          lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
        }],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#111111" },
        elements: [],
      }],
    }],
  };
}
