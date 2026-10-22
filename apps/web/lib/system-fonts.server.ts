// SPDX-License-Identifier: Apache-2.0
import {
  createSystemFontScanner,
  systemFontRoots,
  type SystemFontRoot,
  type SystemFontScanner,
} from "@screenshot-studio/cli/system-fonts";
import { isRecord } from "./json-guards.js";

export const SYSTEM_FONT_ROOTS_ENV = "SCREENSHOT_STUDIO_SYSTEM_FONT_ROOTS";

function parseRootsOverride(raw: string): SystemFontRoot[] {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!Array.isArray(parsed) || !parsed.every((root) => (
    isRecord(root)
    && typeof root.dir === "string"
    && (root.source === "user" || root.source === "system")
  ))) {
    throw new TypeError(`${SYSTEM_FONT_ROOTS_ENV} must be a JSON array of { dir, source } objects`);
  }
  return parsed.map(({ dir, source }) => ({ dir, source }));
}

/** The override exists so browser tests do not depend on the host's fonts; production never reads it. */
export function systemFontRootsFromEnvironment(env: NodeJS.ProcessEnv = process.env): SystemFontRoot[] {
  const override = env[SYSTEM_FONT_ROOTS_ENV];
  return override && env.NODE_ENV !== "production" ? parseRootsOverride(override) : systemFontRoots();
}

const SCANNER_GLOBAL_KEY = Symbol.for("screenshot-studio.system-font-scanner");

// Next development recompiles each route module separately; one shared scan cache serves all of them.
export function sharedSystemFontScanner(): SystemFontScanner {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = serverGlobal[SCANNER_GLOBAL_KEY] as SystemFontScanner | undefined;
  if (existing) return existing;
  const scanner = createSystemFontScanner({ roots: systemFontRootsFromEnvironment() });
  serverGlobal[SCANNER_GLOBAL_KEY] = scanner;
  return scanner;
}
