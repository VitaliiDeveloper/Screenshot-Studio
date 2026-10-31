// SPDX-License-Identifier: Apache-2.0
import { Project as ProjectSchema, Publishing, type Project } from "./schema.js";

/** Per store: a value sets it, null clears it, an omitted key keeps it. */
export interface PublishingPatch {
  apple?: Publishing["apple"] | null;
  google?: Publishing["google"] | null;
}

/** Returns the same object when nothing changes, and drops the block once no store is left. */
export function setPublishing(project: Project, patch: PublishingPatch): Project {
  const next = { ...project.publishing, ...patch };
  if (next.apple == null) delete next.apple;
  if (next.google == null) delete next.google;
  if (JSON.stringify(next) === JSON.stringify(project.publishing ?? {})) return project;
  const checked = Publishing.safeParse(next);
  if (!checked.success) throw new Error(checked.error.issues.map((issue) => issue.message).join("\n"));
  const { publishing: _previous, ...rest } = project;
  return ProjectSchema.parse(Object.keys(next).length > 0 ? { ...rest, publishing: next } : rest);
}
