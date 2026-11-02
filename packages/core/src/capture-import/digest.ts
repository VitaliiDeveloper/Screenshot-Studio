// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function jsonDigest(value: unknown): string {
  return digest(new TextEncoder().encode(JSON.stringify(value)));
}
