// SPDX-License-Identifier: Apache-2.0
import type { Project as ProjectModel } from "./schema.js";
import { fontIdentityKey, type FontIdentity } from "./font-identity.js";
import { elementLeaves } from "./element-tree.js";

/** Text font identities that have no file-backed project font. Pure: filesystem loading stays in hosts. */
export function findUnresolvedFonts(project: ProjectModel): FontIdentity[] {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  const unresolved: FontIdentity[] = [];
  const seen = new Set<string>();

  for (const screen of project.screens) {
    for (const element of screen.elements) {
      for (const leaf of elementLeaves(element)) {
        if (leaf.type !== "text") continue;
        const key = fontIdentityKey({ family: leaf.fontFamily, weight: leaf.weight });
        if (!registered.has(key) && !seen.has(key)) {
          unresolved.push({ family: leaf.fontFamily, weight: leaf.weight });
          seen.add(key);
        }
      }
    }
  }
  return unresolved;
}

export function formatUnresolvedFontsError(unresolved: readonly FontIdentity[]): string {
  const identities = unresolved.map((font) => `"${font.family}" ${font.weight}`).join(", ");
  return `Cannot export: unresolved project fonts: ${identities}. Register each font in the Fonts dialog or with screenshots font add.`;
}

/** Reject nondeterministic system-font fallbacks before a render host or browser is created. */
export function assertProjectFontsResolved(project: ProjectModel): void {
  const unresolved = findUnresolvedFonts(project);
  if (unresolved.length > 0) throw new Error(formatUnresolvedFontsError(unresolved));
}
