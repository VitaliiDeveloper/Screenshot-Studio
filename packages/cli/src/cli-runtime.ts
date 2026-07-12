// SPDX-License-Identifier: Apache-2.0
import type { RunningServer } from "./server.js";

// Deliberately incorrect characterization stubs. The RED commit records the lifecycle contracts
// before the production extraction is replayed.
export function failWhenServerExits<T>(_server: RunningServer, operation: Promise<T>): Promise<T> {
  return operation;
}

export async function closeAll(actions: Array<() => Promise<void>>): Promise<void> {
  for (const action of [...actions].reverse()) await action();
}

export async function runWithCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await cleanup();
  }
}
