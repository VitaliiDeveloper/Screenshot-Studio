// SPDX-License-Identifier: Apache-2.0
import type { RunningServer } from "./server.js";

export function failWhenServerExits<T>(server: RunningServer, operation: Promise<T>): Promise<T> {
  return Promise.race([
    operation,
    server.exited.then((error) => { throw error; }),
  ]);
}

export async function closeAll(actions: Array<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(actions.map((action) => action()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Multiple runtime resources failed to close");
  }
}

export async function runWithCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result: T | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    result = await operation();
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    if (hasPrimaryError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `${primaryError instanceof Error ? primaryError.message : String(primaryError)}; runtime cleanup failed`,
        { cause: cleanupError },
      );
    }
    throw cleanupError;
  }
  if (hasPrimaryError) throw primaryError;
  return result!;
}
