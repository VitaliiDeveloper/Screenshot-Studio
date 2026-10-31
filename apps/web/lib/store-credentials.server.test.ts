// SPDX-License-Identifier: Apache-2.0
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
    const keyPath = join(root, "store-credentials", "app-store-connect.p8");
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(keyPath, "utf8")).toBe(apple.privateKey);
    expect(JSON.parse(await readFile(join(root, "store-credentials", "app-store-connect.json"), "utf8")))
      .toEqual({ keyId: apple.keyId, issuerId: apple.issuerId });
    expect((await stat(join(root, "store-credentials"))).mode & 0o777).toBe(0o700);
    expect(await readFile(join(root, "store-credentials", ".gitignore"), "utf8")).toBe("*\n");
    expect(await store.appleCredentials()).toEqual({ keyId: apple.keyId, issuerId: apple.issuerId, keyPath });

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
    await store.clear("apple");
    expect(await readdir(join(root, "store-credentials"))).toEqual([".gitignore"]);
    await store.setApple(testAppleCredentials());
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
      const error = (await attempt.catch((caught: unknown) => caught)) as Error;
      expect(error.message).not.toContain("sentinel-secret");
    }
    expect((await store.status()).google.configured).toBe(false);
  });

  it("refuses a data folder inside the active project folder", async () => {
    const project = join(root, "project");
    const inside = createStoreCredentialStore(join(project, ".screenshot-studio"));
    await expect(assertCredentialsOutsideProject(inside, project)).rejects.toThrow(StoreCredentialError);
    await expect(assertCredentialsOutsideProject(inside, join(root, "other"))).resolves.toBeUndefined();
    // A folder whose name starts with ".." is still inside the project.
    const dotted = createStoreCredentialStore(join(project, "..x"));
    await expect(assertCredentialsOutsideProject(dotted, project)).rejects.toThrow(StoreCredentialError);
    const sibling = createStoreCredentialStore(join(root, "project-data"));
    await expect(assertCredentialsOutsideProject(sibling, project)).resolves.toBeUndefined();
  });

  it("sees through a symlinked data root and refuses a symlinked key folder", async () => {
    const project = join(root, "project");
    await mkdir(project);
    await symlink(project, join(root, "link"));
    const linked = createStoreCredentialStore(join(root, "link"));
    await expect(assertCredentialsOutsideProject(linked, join(root, "elsewhere"))).resolves.toBeUndefined();
    await expect(assertCredentialsOutsideProject(linked, project)).rejects.toThrow(StoreCredentialError);

    await mkdir(join(root, "data"));
    await mkdir(join(root, "target"));
    await symlink(join(root, "target"), join(root, "data", "store-credentials"));
    const planted = createStoreCredentialStore(join(root, "data"));
    await expect(planted.setGoogle(testGoogleServiceAccount())).rejects.toThrow("symbolic link");
    expect(await readdir(join(root, "target"))).toEqual([]);
  });
});
