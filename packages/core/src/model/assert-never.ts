// SPDX-License-Identifier: Apache-2.0
/** Exhaustiveness helper: call in the default branch of a switch so new union members fail at compile time. */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}
