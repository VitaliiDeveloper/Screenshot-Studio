// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCodexAuthStore, readCodexAuthStore } from "./codex-auth-store.server.js";

describe("parseCodexAuthStore", () => {
  it.each([
    ['cli_auth_credentials_store = "file"', "file"],
    ['cli_auth_credentials_store = "keyring"  # macOS Keychain', "keyring"],
    ["  cli_auth_credentials_store='auto'", "auto"],
    ['cli_auth_credentials_store = "ephemeral"', null],
    ['model = "gpt-5.5"', "file"],
    ['cli_auth_credentials_store = "vault"', "file"],
    ["cli_auth_credentials_store = keyring", "file"],
    ['[profiles.work]\ncli_auth_credentials_store = "keyring"', "file"],
    ["{ not toml", "file"],
  ])("reads %j as %s", (config, store) => {
    expect(parseCodexAuthStore(`approval_policy = "on-request"\n${config}\n`)).toBe(store);
  });
});

describe("readCodexAuthStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "codex-auth-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads CODEX_HOME first, then ~/.codex, and falls back to file", async () => {
    await mkdir(join(root, "codex-home"));
    await mkdir(join(root, ".codex"));
    await writeFile(join(root, "codex-home", "config.toml"), 'cli_auth_credentials_store = "keyring"\n');
    await writeFile(join(root, ".codex", "config.toml"), 'cli_auth_credentials_store = "auto"\n');

    expect(await readCodexAuthStore({ NODE_ENV: "test", CODEX_HOME: join(root, "codex-home"), HOME: root })).toBe("keyring");
    expect(await readCodexAuthStore({ NODE_ENV: "test", HOME: root })).toBe("auto");
    expect(await readCodexAuthStore({ NODE_ENV: "test", CODEX_HOME: join(root, "missing"), HOME: root })).toBe("file");
    expect(await readCodexAuthStore({ NODE_ENV: "test" })).toBe("file");
  });
});
