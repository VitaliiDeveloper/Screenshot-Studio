// SPDX-License-Identifier: Apache-2.0
import {
  applyThemeFile,
  listThemes,
  ThemeApplyError,
  ThemeNotFoundError,
  ThemeValidationError,
} from "@screenshot-studio/cli/theme-service";

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ThemeValidationError ? 400
    : error instanceof ThemeNotFoundError ? 404
      : error instanceof ThemeApplyError ? 422
        : 500;
  return Response.json({ error: message }, { status });
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    throw new ThemeValidationError("request body must be valid JSON", { cause: error });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ThemeValidationError("request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export async function handleThemeGet(projectPath: string): Promise<Response> {
  try {
    return Response.json({ themes: await listThemes(projectPath) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleThemePost(projectPath: string, req: Request): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const { project, revision } = await applyThemeFile(
      projectPath,
      body.id,
      {},
      typeof body.layoutId === "string" ? body.layoutId : undefined,
    );
    return Response.json(project, { headers: { etag: `"${revision}"` } });
  } catch (error) {
    return errorResponse(error);
  }
}
