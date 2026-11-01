// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";

/**
 * Optional "newer version available" notice. The only network call the CLI makes on its own:
 * one anonymous GET of the public npm registry document, at most once per 24 h, interactive runs
 * only. Every failure is swallowed so the check can never break or noticeably slow a command.
 */

const PACKAGE_NAME = "@screenshot-studio/cli";
export const UPDATE_CHECK_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 1500;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string) {
  const match = SEMVER.exec(version);
  return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] } : undefined;
}

/** Semver precedence (prereleases ordered per spec); undefined when either side is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return undefined;
  for (let i = 0; i < 3; i++) {
    if (left.core[i]! !== right.core[i]!) return left.core[i]! < right.core[i]! ? -1 : 1;
  }
  if (!left.pre.length || !right.pre.length) {
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1;
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function isSet(value: string | undefined): boolean {
  return value !== undefined && !["", "0", "false"].includes(value.toLowerCase());
}

export function updateCheckDisabled(env: NodeJS.ProcessEnv, interactive: boolean): boolean {
  return !interactive || isSet(env.CI) || isSet(env.NO_UPDATE_NOTIFIER) || isSet(env.SCREENSHOTS_NO_UPDATE_CHECK);
}

export function updateCacheFile(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const path = platform === "win32" ? win32 : posix;
  const base = platform === "win32"
    ? env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    : platform === "darwin"
      ? path.join(home, "Library", "Caches")
      : env.XDG_CACHE_HOME ?? path.join(home, ".cache");
  return path.join(base, "screenshot-studio", "update-check.json");
}

export function formatUpdateNotice(current: string, latest: string): string {
  return `Update available: ${current} → ${latest}. Run: pnpm add --global ${PACKAGE_NAME}@${latest}`;
}

interface UpdateCache {
  checkedAt: number;
  latest?: string;
}

export interface UpdateCheckDependencies {
  env: NodeJS.ProcessEnv;
  interactive: boolean;
  now: () => number;
  fetch: typeof fetch;
  readCache: () => Promise<UpdateCache | undefined>;
  writeCache: (cache: UpdateCache) => Promise<void>;
}

async function fetchLatest(fetchImpl: typeof fetch): Promise<string | undefined> {
  const response = await fetchImpl(UPDATE_CHECK_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const { version } = await response.json() as { version?: unknown };
  // The value is printed to the terminal, so only a well-formed version is trusted.
  return typeof version === "string" && parseVersion(version) ? version : undefined;
}

/** The notice line when a newer version exists, otherwise undefined. Never throws. */
export async function checkForUpdate(current: string, deps: UpdateCheckDependencies): Promise<string | undefined> {
  if (updateCheckDisabled(deps.env, deps.interactive)) return undefined;
  try {
    const now = deps.now();
    const cache = await deps.readCache().catch(() => undefined);
    let latest = cache?.latest;
    const fresh = cache !== undefined && now >= cache.checkedAt && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS;
    if (!fresh) {
      latest = await fetchLatest(deps.fetch).catch(() => undefined) ?? latest;
      // A failed or 404 attempt is recorded too, so an offline machine retries once per interval.
      await deps.writeCache({ checkedAt: now, ...(latest ? { latest } : {}) }).catch(() => undefined);
    }
    return latest && compareVersions(current, latest) === -1 ? formatUpdateNotice(current, latest) : undefined;
  } catch {
    return undefined;
  }
}

function realDependencies(): UpdateCheckDependencies {
  const file = updateCacheFile(process.env, process.platform, homedir());
  return {
    env: process.env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    now: Date.now,
    fetch,
    async readCache() {
      const cache = JSON.parse(await readFile(file, "utf8")) as Partial<UpdateCache>;
      return typeof cache.checkedAt === "number"
        ? { checkedAt: cache.checkedAt, ...(typeof cache.latest === "string" ? { latest: cache.latest } : {}) }
        : undefined;
    },
    async writeCache(cache) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(cache));
    },
  };
}

async function readOwnVersion(): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return manifest.version;
  } catch {
    return undefined;
  }
}

/** Start the check alongside the command; the returned promise resolves to the notice (or nothing). */
export async function startUpdateCheck(deps?: UpdateCheckDependencies): Promise<string | undefined> {
  // A source checkout (run through tsx) updates with `git pull`, so a registry notice would mislead.
  if (!deps && import.meta.url.endsWith(".ts")) return undefined;
  try {
    const current = await readOwnVersion();
    return current ? await checkForUpdate(current, deps ?? realDependencies()) : undefined;
  } catch {
    return undefined;
  }
}
