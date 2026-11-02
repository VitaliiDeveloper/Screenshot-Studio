// SPDX-License-Identifier: Apache-2.0

export type ShutdownProcess = Pick<NodeJS.Process, "once" | "listenerCount" | "kill" | "pid">;

/**
 * Cancels every agent run when the server stops. Agent process groups are detached, so a signal to
 * the server never reaches them, and `next dev` SIGKILLs its server 100 ms after forwarding a signal,
 * before any `exit` hook runs. Exiting stays with Next's own signal handler, which closes the server
 * once the cancelled runs have their verdicts and their streams end.
 */
export function cancelRunsOnShutdown(cancelAll: () => void, target: ShutdownProcess = process): void {
  target.once("exit", cancelAll);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    target.once(signal, () => {
      cancelAll();
      // A signal listener replaces the default exit, so a signal nothing else handles is re-raised.
      if (target.listenerCount(signal) === 0) target.kill(target.pid, signal);
    });
  }
}
