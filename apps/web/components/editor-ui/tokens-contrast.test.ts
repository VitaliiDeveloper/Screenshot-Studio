// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readTokensCss, tokenBlock } from "./token-css-test-helpers.js";

type Rgba = readonly [number, number, number, number];

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] ?? "", 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+)%)?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4]) / 100];
  throw new Error(`Unsupported token color: ${value}`);
}

function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgba, background: Rgba): number {
  const [light, dark] = [luminance(foreground) + 0.05, luminance(background) + 0.05].sort((a, b) => b - a);
  return (light ?? 1) / (dark ?? 1);
}

/** [foreground, background] token pairs that carry readable text (WCAG 1.4.3, 4.5:1). */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ...["text", "text-strong", "text-default", "text-muted"].flatMap((text) =>
    ["surface", "surface-subtle", "surface-muted"].map((surface) => [text, surface] as const)),
  ["text-secondary", "surface"],
  ["text-secondary", "surface-subtle"],
  ["text-secondary", "surface-muted"],
  ["accent-text", "surface"],
  ["accent-text", "accent-subtle"],
  ["accent-text-strong", "surface"],
  ["accent-text-strong", "accent-subtle"],
  ["accent-text-strong", "accent-muted"],
  ["accent-strong", "accent-subtle"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ["on-accent", "danger"],
  ["on-accent", "danger-hover"],
  ["on-accent", "agent"],
  ["on-accent", "agent-hover"],
  ["on-inverse", "surface-inverse"],
  ["on-badge", "badge"],
  ["danger-text", "surface"],
  ["danger-text", "danger-surface"],
  ["warning-text", "surface"],
  ["warning-text", "warning-surface"],
  ["warning-text-strong", "warning-surface"],
  ["success-text", "surface"],
  ["success-text", "success-surface"],
  ["agent-text", "surface"],
  ["agent-text", "agent-surface"],
];

/** [indicator, background] pairs for focus rings and selection lines (WCAG 1.4.11, 3:1). */
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["focus", "surface"],
  ["focus", "surface-subtle"],
  ["danger-focus", "surface"],
  ["selection", "canvas"],
];

/**
 * Known deviation, kept from the Turn 6 design: `text-subtle` still labels small hints and
 * placeholders. It is held to a 3:1 floor (it was 2.6:1 before Turn 6) instead of 4.5:1.
 */
const HINT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["text-subtle", "surface"],
  ["text-subtle", "surface-subtle"],
];

const DARK_THEME = "@media (prefers-color-scheme: dark)";

/** Dark mode inherits every light token it does not override, exactly as the cascade does. */
async function themes(): Promise<Array<{ name: string; tokens: Map<string, string> }>> {
  const css = await readTokensCss();
  const light = tokenBlock(css, ":root");
  const dark = tokenBlock(css, ":root", css.indexOf(DARK_THEME));
  return [
    { name: "light", tokens: light },
    { name: "dark", tokens: new Map([...light, ...dark]) },
  ];
}

describe("editor color token contrast", () => {
  it("overrides only known tokens in the dark theme", async () => {
    const css = await readTokensCss();
    const light = tokenBlock(css, ":root");
    const dark = tokenBlock(css, ":root", css.indexOf(DARK_THEME));

    expect(css.indexOf(DARK_THEME)).toBeGreaterThan(0);
    expect(dark.size).toBeGreaterThan(40);
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it.each([
    ["text", TEXT_PAIRS, 4.5],
    ["non-text", NON_TEXT_PAIRS, 3],
    ["hint", HINT_PAIRS, 3],
  ] as const)("keeps %s pairs readable in every theme", async (_kind, pairs, minimum) => {
    const failures: string[] = [];
    for (const { name, tokens } of await themes()) {
      const color = (role: string) => parseColor(tokens.get(`--editor-color-${role}`) ?? `missing ${role}`);
      for (const [foreground, background] of pairs) {
        const backdrop = color(background);
        const ratio = contrast(over(color(foreground), backdrop), backdrop);
        if (ratio < minimum) failures.push(`${name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });
});
