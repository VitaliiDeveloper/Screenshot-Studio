// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGooglePlayServiceAccount } from "./google-play-client.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function accountFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "google-play-account-"));
  roots.push(root);
  const path = join(root, "account.json");
  await writeFile(path, content);
  return path;
}

describe("readGooglePlayServiceAccount", () => {
  it("reads the client email and private key", async () => {
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const account = await readGooglePlayServiceAccount(await accountFile(JSON.stringify({ client_email: "a@b.iam", private_key: pem })));
    expect(account.clientEmail).toBe("a@b.iam");
    expect(account.privateKey.asymmetricKeyType).toBe("rsa");
  });

  it("never quotes the file in its errors", async () => {
    const secret = "-----BEGIN PRIVATE KEY-----MIIsecret";
    const error = await readGooglePlayServiceAccount(await accountFile(`{"private_key": "${secret}`))
      .catch((caught: Error) => caught);
    expect((error as Error).message).toBe("The Google Play service account file is not valid JSON");
    expect((error as Error).cause).toBeUndefined();
  });

  it.each([
    ["missing fields", JSON.stringify({ client_email: "a@b.iam" }), /needs client_email and private_key/],
    ["a key that is not PEM", JSON.stringify({ client_email: "a@b.iam", private_key: "not-a-key" }), /private_key is not a valid PEM key/],
  ])("rejects %s", async (_case, content, message) => {
    await expect(readGooglePlayServiceAccount(await accountFile(content))).rejects.toThrow(message);
  });

  it("reports a missing file by its error code only", async () => {
    await expect(readGooglePlayServiceAccount(join(tmpdir(), "no-such-dir-play", "account.json")))
      .rejects.toThrow(/^Cannot read the Google Play service account file: ENOENT$/);
  });
});
