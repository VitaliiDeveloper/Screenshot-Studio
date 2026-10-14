// SPDX-License-Identifier: Apache-2.0
import process from "node:process";

/**
 * Resolve how a script re-invokes pnpm as `[executable, args]` for `execFile`. The pnpm that
 * started the script (`npm_execpath`) may be a JavaScript entry (Corepack, CI), a native binary, or
 * the shebang-less placeholder npm 12 leaves when it skips pnpm's install script. Only a shell can
 * start the placeholder, so POSIX non-JavaScript entries go through `/bin/sh`.
 */
export function pnpmCommand(args, env = process.env, platform = process.platform) {
  const entry = env.npm_execpath;
  if (platform === "win32") {
    if (!entry) throw new Error("pnpm entrypoint is unavailable");
    return /\.exe$/i.test(entry) ? [entry, args] : [process.execPath, [entry, ...args]];
  }
  if (entry && /\.[cm]?js$/.test(entry)) return [process.execPath, [entry, ...args]];
  return ["/bin/sh", ["-c", 'exec "$0" "$@"', entry ?? "pnpm", ...args]];
}
