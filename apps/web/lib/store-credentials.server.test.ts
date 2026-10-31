// SPDX-License-Identifier: Apache-2.0
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertCredentialsOutsideProject,
  createStoreCredentialStore,
  StoreCredentialError,
} from "./store-credentials.server.js";
import { testAppleCredentials, testGoogleServiceAccount } from "./store-credentials-test-support.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "store-credentials-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("store credential store", () => {
  it("reports nothing configured when the files are missing", async () => {
    const store = createStoreCredentialStore(root);
    expect(await store.status()).toEqual({
      google: { configured: false, updatedAt: null },
      apple: { configured: false, updatedAt: null },
    });
    expect(await store.googleServiceAccountPath()).toBeUndefined();
    expect(await store.appleCredentials()).toBeUndefined();
  });

  it("writes each store's key as a 0600 file in a 0700 git-ignored folder", async () => {
    const store = createStoreCredentialStore(root);
    const google = testGoogleServiceAccount();
    const apple = testAppleCredentials();
    await store.setGoogle(google);
    await store.setApple(apple);

    const path = await store.googleServiceAccountPath();
    expect(path).toBe(join(root, "store-credentials", "google-play-service-account.json"));
    expect(await readFile(path!, "utf8")).toBe(google);
    expect((await stat(path!)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "store-credentials", "app-store-connect.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "store-credentials"))).mode & 0o777).toBe(0o700);
    expect(await readFile(join(root, "store-credentials", ".gitignore"), "utf8")).toBe("*\n");
    expect(await store.appleCredentials()).toEqual(apple);

    const status = await store.status();
    expect(status.google.configured).toBe(true);
    expect(status.apple.configured).toBe(true);
    expect(Date.parse(status.google.updatedAt!)).not.toBeNaN();
  });

  it("clears one store without touching the other", async () => {
    const store = createStoreCredentialStore(root);
    await store.setGoogle(testGoogleServiceAccount());
    await store.setApple(testAppleCredentials());
    await store.clear("google");
    await store.clear("google");
    const status = await store.status();
    expect(status.google).toEqual({ configured: false, updatedAt: null });
    expect(status.apple.configured).toBe(true);
  });

  it("treats a malformed or unreadable file as not configured", async () => {
    const store = createStoreCredentialStore(root);
    await mkdir(join(root, "store-credentials"), { recursive: true });
    await writeFile(join(root, "store-credentials", "google-play-service-account.json"), "{not json");
    await store.setApple(testAppleCredentials());
    await chmod(join(root, "store-credentials", "app-store-connect.json"), 0o000);
    const status = await store.status();
    expect(status.google.configured).toBe(false);
    // Root can read a 0000 file, so this half only holds for a normal user.
    if (process.getuid?.() !== 0) expect(status.apple.configured).toBe(false);
  });

  it("rejects invalid keys with messages that never quote the input", async () => {
    const store = createStoreCredentialStore(root);
    const secret = "-----BEGIN PRIVATE KEY-----sentinel-secret";
    await expect(store.setGoogle(`{"private_key":"${secret}`)).rejects.toThrow(StoreCredentialError);
    await expect(store.setGoogle(JSON.stringify({ client_email: "a@b", private_key: secret })))
      .rejects.toThrow("not a valid PEM key");
    await expect(store.setApple({ ...testAppleCredentials(), privateKey: secret })).rejects.toThrow("not a valid private key");
    await expect(store.setApple({ ...testAppleCredentials(), keyId: "short" })).rejects.toThrow("Apple key id");
    for (const attempt of [
      store.setGoogle(`{"private_key":"${secret}`),
      store.setApple({ ...testAppleCredentials(), privateKey: secret }),
    ]) {
      const error = await attempt.catch((caught: unknown) => caught as Error);
      expect(error.message).not.toContain("sentinel-secret");
    }
    expect((await store.status()).google.configured).toBe(false);
  });

  it("refuses a data folder inside the active project folder", () => {
    const store = createStoreCredentialStore(join(root, "project", ".screenshot-studio"));
    expect(() => assertCredentialsOutsideProject(store, join(root, "project"))).toThrow(StoreCredentialError);
    expect(() => assertCredentialsOutsideProject(store, join(root, "other"))).not.toThrow();
  });
});
