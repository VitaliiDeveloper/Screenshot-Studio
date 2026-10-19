// SPDX-License-Identifier: Apache-2.0
import {
  ProjectScaffoldInput,
  type ProjectScaffoldInput as ProjectCreationInput,
} from "@screenshot-studio/core/scaffold";
import type {
  ActiveProjectDescriptor,
  ActiveProjectSelection,
} from "./project-session.js";
import { readJsonBody, responseErrorMessage } from "@web/lib/json-response.js";

export type ProjectCreationTransport = (
  input: ProjectCreationInput,
) => Promise<Response>;

export interface CreateProjectOptions {
  transport?: ProjectCreationTransport;
}

const MANAGED_PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;

export class ProjectCreationClientError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ProjectCreationClientError";
  }
}

const fetchProjectCreation: ProjectCreationTransport = (input) => fetch("/api/project-create", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
});

export async function createProject(
  input: ProjectCreationInput,
  options: CreateProjectOptions = {},
): Promise<ActiveProjectSelection> {
  const parsedInput = ProjectScaffoldInput.parse(input);
  const response = await (options.transport ?? fetchProjectCreation)(parsedInput);
  const body = await readJsonBody(response) as {
    project?: ActiveProjectDescriptor;
    error?: unknown;
    code?: unknown;
  };
  if (!response.ok) {
    throw new ProjectCreationClientError(
      responseErrorMessage(body, `Project creation failed (${response.status})`),
      typeof body.code === "string" ? body.code : "request-failed",
    );
  }
  if (!body.project || typeof body.project.name !== "string"
    || typeof body.project.sessionId !== "string"
    || body.project.sourceKind !== "managed-project"
    || typeof body.project.capabilities !== "object"
    || body.project.capabilities === null) {
    throw new ProjectCreationClientError("Project creation returned an invalid response", "invalid-response");
  }
  const projectId = response.headers.get("x-project-id")?.trim();
  if (!projectId || !MANAGED_PROJECT_ID_PATTERN.test(projectId)) {
    throw new ProjectCreationClientError(
      "Project creation response is missing its project identity",
      "invalid-response",
    );
  }
  return { ...body.project, projectId };
}
