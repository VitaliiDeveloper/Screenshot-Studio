// SPDX-License-Identifier: Apache-2.0
import { fontIdentityKey, type FontIdentity } from "./font-identity.js";

/**
 * Renderer-owned, file-backed fonts that are available to every project without becoming
 * project-local resources. Keep this catalog aligned with the browser renderer's @font-face rules.
 */
export const BUILT_IN_FONT_IDENTITIES = [{
  family: "Screenshot Studio Sans",
  weight: 400,
  label: "Studio Sans · Regular",
}] as const satisfies readonly (FontIdentity & { label: string })[];

export const DEFAULT_TEXT_FONT: FontIdentity = BUILT_IN_FONT_IDENTITIES[0];

const builtInFontKeys = new Set<string>(BUILT_IN_FONT_IDENTITIES.map(fontIdentityKey));

export function isBuiltInFontIdentity(identity: FontIdentity): boolean {
  return builtInFontKeys.has(fontIdentityKey(identity));
}

/** Prefer the project's first custom font while keeping empty projects immediately authorable. */
export function preferredAuthoringFont(fonts: readonly FontIdentity[]): FontIdentity {
  return fonts[0] ?? DEFAULT_TEXT_FONT;
}
