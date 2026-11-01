// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";

// Generated once per test file: RSA key generation is slow enough to starve parallel test workers.
let rsaPem: string | undefined;
let ecPem: string | undefined;

export function testGoogleServiceAccount(): string {
  rsaPem ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return JSON.stringify({
    type: "service_account",
    client_email: "uploader@example.iam.gserviceaccount.com",
    private_key: rsaPem,
  });
}

export function testAppleCredentials() {
  ecPem ??= generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return {
    keyId: "ABCDE12345",
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    privateKey: ecPem,
  };
}
