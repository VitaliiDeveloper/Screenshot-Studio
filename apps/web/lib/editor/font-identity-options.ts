// SPDX-License-Identifier: Apache-2.0
import {
  BUILT_IN_FONT_IDENTITIES,
  fontIdentityKey,
  type FontAsset,
} from "@screenshot-studio/core/model";

/** Font menu entries shared by the Layer tab and the canvas selection toolbar. */
export function fontIdentityOptions(
  fonts: readonly FontAsset[],
  current: { family: string; weight: number },
): { value: string; label: string }[] {
  const currentKey = fontIdentityKey(current);
  const allFonts = [
    ...BUILT_IN_FONT_IDENTITIES.map((font) => ({ ...font, builtIn: true as const })),
    ...fonts
      .filter((font) => !BUILT_IN_FONT_IDENTITIES.some((builtIn) => (
        builtIn.family === font.family && builtIn.weight === font.weight
      )))
      .map((font) => ({ ...font, builtIn: false as const })),
  ];
  const resolved = allFonts.some((font) => (
    font.family === current.family && font.weight === current.weight
  ));
  return [
    ...(!resolved ? [{ value: currentKey, label: `Missing: ${current.family} · ${current.weight}` }] : []),
    ...allFonts.map((font) => ({
      value: fontIdentityKey(font),
      label: font.builtIn ? `${font.label} · Built-in` : `${font.family} · ${font.weight}`,
    })),
  ];
}
