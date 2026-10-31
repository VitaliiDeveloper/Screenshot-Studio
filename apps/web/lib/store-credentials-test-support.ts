// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";

export function testGoogleServiceAccount(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    client_email: "uploader@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

export function testAppleCredentials() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    keyId: "ABCDE12345",
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}
