// SPDX-License-Identifier: Apache-2.0
import { elementLeaves } from "./element-tree.js";
import type { FontIdentity } from "./font-identity.js";
import type { Project } from "./schema.js";

/** Count text leaves that use one exact family and weight identity. */
export function countProjectFontUsage(project: Project, font: FontIdentity): number {
  let usage = 0;
  for (const screen of project.screens) {
    for (const element of screen.elements) {
      for (const leaf of elementLeaves(element)) {
        if (
          leaf.type === "text"
          && leaf.fontFamily === font.family
          && leaf.weight === font.weight
        ) {
          usage += 1;
        }
      }
    }
  }
  return usage;
}
