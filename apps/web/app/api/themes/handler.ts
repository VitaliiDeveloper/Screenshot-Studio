import {
  applyThemeFile,
  listThemes,
  ThemeApplyError,
  ThemeNotFoundError,
  ThemeValidationError,
} from "@screenshot-studio/cli/theme-service";
import { resolveProjectPath } from "../../../lib/project-path.js";

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ThemeValidationError ? 400
    : error instanceof ThemeNotFoundError ? 404
      : error instanceof ThemeApplyError ? 422
        : 500;
  return Response.json({ error: message }, { status });
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json() as Record<string, unknown>;
  } catch (error) {
    throw new ThemeValidationError("request body must be valid JSON", { cause: error });
  }
}

export async function handleThemeGet(): Promise<Response> {
  try {
    return Response.json({ themes: await listThemes(resolveProjectPath()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleThemePost(req: Request): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const { project } = await applyThemeFile(resolveProjectPath(), body.id);
    return Response.json(project);
  } catch (error) {
    return errorResponse(error);
  }
}
