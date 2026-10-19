// SPDX-License-Identifier: Apache-2.0
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { acquireManagedProjectLifecycleLock } from "@web/lib/managed-projects/managed-project-lifecycle-lock.server.js";

async function main(): Promise<void> {
  const [root, projectId] = process.argv.slice(2);
  if (!root || !projectId) throw new Error("root and project id are required");
  const lock = await acquireManagedProjectLifecycleLock(
    resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root }),
    projectId,
  );
  process.stdout.write("acquired\n");
  process.on("SIGTERM", () => { void lock.release().finally(() => process.exit(0)); });
  setInterval(() => undefined, 1_000);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
