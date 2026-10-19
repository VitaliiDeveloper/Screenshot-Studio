// SPDX-License-Identifier: Apache-2.0

/** The string `code` of a Node.js system error such as `ENOENT`, if the value carries one. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : undefined;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
