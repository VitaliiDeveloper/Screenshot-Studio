// SPDX-License-Identifier: Apache-2.0
import {
  createTemplateScreen,
  listTemplates,
  TemplateCreateError,
  TemplateNotFoundError,
  TemplateValidationError,
} from "@screenshot-studio/cli/template-service";
import { resolveProjectPath } from "../../../lib/project-path.js";

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TemplateValidationError ? 400
    : error instanceof TemplateNotFoundError ? 404
      : error instanceof TemplateCreateError ? 422
        : 500;
  return Response.json({ error: message }, { status });
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    throw new TemplateValidationError("request body must be valid JSON", { cause: error });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new TemplateValidationError("request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export async function handleTemplateGet(): Promise<Response> {
  try {
    return Response.json({ templates: await listTemplates(resolveProjectPath()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTemplatePost(req: Request): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const { project, revision, screen } = await createTemplateScreen(
      resolveProjectPath(),
      body.id,
      body.locale,
    );
    return Response.json(
      { project, screenId: screen.id },
      { headers: { etag: `"${revision}"` } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
