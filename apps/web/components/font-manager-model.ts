// SPDX-License-Identifier: Apache-2.0
import {
  fontIdentityKey,
  parseProject,
  type FontAsset,
  type Project,
} from "@screenshot-studio/core/model";

type FontMutationOperation =
  | { operation: "add" }
  | { operation: "remove"; removedFont: FontAsset };

export type FontMutationResponseInput = {
  response: Response;
  previousProject: Project;
} & FontMutationOperation;

export interface FontMutationReconciliationDependencies {
  replaceProject(project: Project): void;
  setProjectRevision(revision: string | null): void;
  registerAddedFont?(font: FontAsset): Promise<void>;
  removeBrowserFaces?(font: FontAsset): void;
}

export interface FontMutationReconciliationResult {
  project: Project;
  warning: string | null;
}

function responseError(body: unknown, status: number): Error {
  const message = body && typeof body === "object" && "error" in body
    && typeof body.error === "string"
    ? body.error
    : `Font operation failed (${status})`;
  return new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function reconcileFontMutationResponse(
  input: FontMutationResponseInput,
  dependencies: FontMutationReconciliationDependencies,
): Promise<FontMutationReconciliationResult> {
  const body = await input.response.json().catch(() => ({}));
  if (!input.response.ok) throw responseError(body, input.response.status);

  const project = parseProject(body);
  dependencies.setProjectRevision(input.response.headers.get("etag"));
  dependencies.replaceProject(project);

  if (input.operation === "remove") {
    dependencies.removeBrowserFaces?.(input.removedFont);
    return { project, warning: null };
  }

  const previousKeys = new Set(input.previousProject.fonts.map(fontIdentityKey));
  const added = project.fonts.filter((font) => !previousKeys.has(fontIdentityKey(font)));
  const results = await Promise.allSettled(
    added.map((font) => dependencies.registerAddedFont?.(font) ?? Promise.resolve()),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [errorMessage(result.reason)] : []);
  const warning = failures.length === 0
    ? null
    : `Font was saved to the project, but its browser preview could not load: ${failures.join("; ")}`;
  return { project, warning };
}
