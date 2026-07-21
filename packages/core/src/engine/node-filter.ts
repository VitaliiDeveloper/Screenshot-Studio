// SPDX-License-Identifier: Apache-2.0
import Konva from "konva";
import type { NodeFilter } from "./node-config.js";

/** Apply one shared cached Konva filter contract in both the editor and export renderers. */
export function applyNodeFilter(node: Konva.Node, filter?: NodeFilter): void {
  node.clearCache();
  node.filters([]);
  if (!filter) return;

  switch (filter.kind) {
    case "blur":
      node.cache({ pixelRatio: 1 });
      node.filters([Konva.Filters.Blur]);
      node.setAttr("blurRadius", filter.radius);
      return;
  }
}
