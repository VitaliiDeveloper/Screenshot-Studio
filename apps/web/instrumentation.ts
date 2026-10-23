// SPDX-License-Identifier: Apache-2.0

export async function register(): Promise<void> {
  // The positive check is the form Next prunes from the edge bundle, which cannot load `node:` modules.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { sweepStaleRunFolders } = await import("@web/lib/agents/agent-attachment-store.server.js");
    await sweepStaleRunFolders();
  }
}
