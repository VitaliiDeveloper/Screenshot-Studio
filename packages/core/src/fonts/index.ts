// SPDX-License-Identifier: Apache-2.0
import type { FontAsset } from "../model/schema.js";
import { BUILT_IN_FONT_IDENTITIES } from "../model/built-in-fonts.js";

/**
 * Browser-side font registration. Runs before any render so the project font is the
 * one that actually paints — the font-load race is the concrete failure mode behind the #1
 * parity risk (docs/architecture.md). Callers MUST await this and `whenFontsReady()` before
 * screenshotting; otherwise the first frame can render with a system fallback.
 */

export type ResolveFontUrl = (path: string) => string;

export interface FontRegistrationFailure {
  font: FontAsset;
  error: Error;
}

export class ProjectFontRegistrationError extends AggregateError {
  override name = "ProjectFontRegistrationError";

  constructor(readonly failures: FontRegistrationFailure[]) {
    super(
      failures.map(({ error }) => error),
      `Failed to register ${failures.length} project font${failures.length === 1 ? "" : "s"}: ${failures
        .map(({ font }) => `"${font.family}" ${font.weight}`)
        .join(", ")}`,
    );
  }
}

const fontRegistrations = new WeakMap<FontFaceSet, Map<string, Promise<FontFace>>>();

function registrationsFor(fontSet: FontFaceSet): Map<string, Promise<FontFace>> {
  let registrations = fontRegistrations.get(fontSet);
  if (!registrations) {
    registrations = new Map();
    fontRegistrations.set(fontSet, registrations);
  }
  return registrations;
}

function fontRegistrationKey(asset: FontAsset, url: string): string {
  return JSON.stringify([asset.family, asset.weight, asset.path, url]);
}

/** Register one project font with the document and wait for it to load. */
export async function registerFont(asset: FontAsset, resolve: ResolveFontUrl): Promise<void> {
  const url = resolve(asset.path);
  const fontSet = document.fonts;
  const registrations = registrationsFor(fontSet);
  const key = fontRegistrationKey(asset, url);
  const existing = registrations.get(key);
  if (existing) {
    const face = await existing;
    if (typeof fontSet.has !== "function" || fontSet.has(face)) return;
    registrations.delete(key);
  }

  const registration = (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load font "${asset.family}" from ${asset.path}: HTTP ${response.status}`);
    }
    const face = new FontFace(asset.family, await response.arrayBuffer(), {
      weight: String(asset.weight),
    });
    await face.load();
    fontSet.add(face);
    return face;
  })();
  registrations.set(key, registration);
  try {
    await registration;
  } catch (error) {
    if (registrations.get(key) === registration) registrations.delete(key);
    throw error;
  }
}

/** Register every project font, then wait for the font set to settle. */
export async function registerProjectFonts(fonts: FontAsset[], resolve: ResolveFontUrl): Promise<void> {
  const fontSet = document.fonts;
  const registrations = registrationsFor(fontSet);
  const desiredKeys = new Set(fonts.map((font) => (
    fontRegistrationKey(font, resolve(font.path))
  )));
  const staleRegistrations = [...registrations].filter(([key]) => !desiredKeys.has(key));
  for (const [key] of staleRegistrations) registrations.delete(key);
  await Promise.all(staleRegistrations.map(async ([, registration]) => {
    const face = await registration.then(
      (registeredFace) => registeredFace,
      () => undefined,
    );
    if (face) fontSet.delete(face);
  }));

  const results = await Promise.allSettled(fonts.map((font) => registerFont(font, resolve)));
  const failures = results.flatMap((result, index): FontRegistrationFailure[] => {
    if (result.status === "fulfilled") return [];
    const error = result.reason instanceof Error
      ? result.reason
      : new Error(String(result.reason), { cause: result.reason });
    return [{ font: fonts[index]!, error }];
  });
  if (failures.length > 0) throw new ProjectFontRegistrationError(failures);
  await Promise.all(BUILT_IN_FONT_IDENTITIES.map((font) => (
    document.fonts.load(`${font.weight} 16px "${font.family}"`)
  )));
  await document.fonts.ready;
}

/**
 * Resolve once a specific family is usable at a given size. Belt-and-suspenders on top of
 * `document.fonts.ready` for the exact family/size a screen renders with.
 */
export async function whenFontReady(family: string, size: number): Promise<void> {
  await document.fonts.load(`${size}px "${family}"`);
}
