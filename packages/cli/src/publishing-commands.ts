// SPDX-License-Identifier: Apache-2.0
import { setPublishing, type Project, type PublishingPatch } from "@screenshot-studio/core/model";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { loadProjectFile, updateProjectFile } from "./project-io.js";

const USAGE = "Usage: screenshots publishing <show|set|clear> [--google-package <name>] [--apple-app-id <id>] [--json]";

function formatPublishing(project: Project, json: boolean): string {
  const publishing = project.publishing ?? {};
  if (json) return JSON.stringify(publishing);
  return [
    `google packageName=${publishing.google?.packageName ?? "(not set)"}`,
    `apple appId=${publishing.apple?.appId ?? "(not set)"}`,
  ].join("\n");
}

/** Store app identifiers only; credentials come from the environment of `screenshots upload`. */
export async function runPublishingCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const [subcommand = "show", store, extra] = args;
  const json = flags.json === "true";
  if (subcommand === "show") {
    if (store) throw new Error(USAGE);
    return formatPublishing(await loadProjectFile(projectPath), json);
  }

  let patch: PublishingPatch;
  if (subcommand === "set") {
    if (store) throw new Error(USAGE);
    patch = {
      ...(flags["google-package"] !== undefined ? { google: { packageName: flags["google-package"] } } : {}),
      ...(flags["apple-app-id"] !== undefined ? { apple: { appId: flags["apple-app-id"] } } : {}),
    };
    if (!patch.google && !patch.apple) throw new Error("publishing set requires --google-package or --apple-app-id");
  } else if (subcommand === "clear") {
    if ((store !== "google" && store !== "apple") || extra) throw new Error("Usage: screenshots publishing clear <google|apple>");
    patch = { [store]: null };
  } else {
    throw new Error(USAGE);
  }
  const updated = await updateProjectFile(projectPath, (project) => ({
    project: setPublishing(project, patch),
    value: undefined,
  }), lockOptions);
  return formatPublishing(updated.project, json);
}
