// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Stores another `codex` process can read; `ephemeral` sign-ins live inside one process only. */
export type CodexAuthStore = "file" | "keyring" | "auto";

const STORES: readonly string[] = ["file", "keyring", "auto"];
const STORE_LINE = /^\s*cli_auth_credentials_store\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/;

/**
 * The `cli_auth_credentials_store` of a config.toml, or null for `ephemeral`. A missing or
 * unreadable setting is Codex's own default, `file`; `auto` is never assumed, because a keyring
 * save deletes auth.json and would move a file-store sign-in mid-run.
 * shortcut: reads the top-level key line by line, so a quoted key, a profile-level override, or the
 * key inside a multi-line string is not recognized; switch to a TOML parser if one joins the repo.
 */
export function parseCodexAuthStore(config: string): CodexAuthStore | null {
  for (const line of config.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = STORE_LINE.exec(line);
    if (!match) continue;
    const value = match[1] ?? match[2] ?? "";
    if (value === "ephemeral") return null;
    return STORES.includes(value) ? value as CodexAuthStore : "file";
  }
  return "file";
}

/** Reads only that key from `$CODEX_HOME/config.toml` (default `~/.codex`), as the CLI resolves it. */
export async function readCodexAuthStore(env: NodeJS.ProcessEnv): Promise<CodexAuthStore | null> {
  const home = env.CODEX_HOME || (env.HOME ? join(env.HOME, ".codex") : undefined);
  if (!home) return "file";
  return readFile(join(home, "config.toml"), "utf8").then(parseCodexAuthStore, () => "file");
}

/** Probe and run both get the store explicitly, since runs ignore the user's config.toml. */
export function codexAuthStoreOverride(store: CodexAuthStore): string[] {
  return ["-c", `cli_auth_credentials_store="${store}"`];
}
