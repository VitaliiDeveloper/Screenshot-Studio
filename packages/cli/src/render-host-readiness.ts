// SPDX-License-Identifier: Apache-2.0

/** Tells a Screenshot Studio host's /api/instance answer from any other program's. */
export async function isStudioInstance(response: Response): Promise<boolean> {
  const body: unknown = response.ok ? await response.json().catch(() => null) : null;
  return (body as { app?: unknown } | null)?.app === "screenshot-studio";
}

export async function waitForHttp(url: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // The first Next dev request compiles the route, so one attempt may take the whole remaining budget.
      const response = await fetchImpl(`${url}/api/instance`, {
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (await isStudioInstance(response)) return;
    } catch {
      // Not listening yet, or the attempt ran out of time.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Web server did not become ready within ${timeoutMs}ms`);
}
