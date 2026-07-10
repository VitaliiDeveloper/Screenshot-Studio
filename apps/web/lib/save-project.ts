// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";

/** Persist the project to disk through the API route (spec §4). Throws on a validation reject. */
export async function saveProject(project: Project): Promise<void> {
  const res = await fetch("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
}
