// SPDX-License-Identifier: Apache-2.0
import {
  applyBuiltInDesignPackFile,
  applyThemeFile,
  listThemes,
  ThemeApplyError,
  ThemeNotFoundError,
  ThemeValidationError,
} from "@screenshot-studio/cli/theme-service";
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import { errorResponseByClass, type ErrorStatusTable } from "@web/lib/project-request-fence.server.js";

const ERROR_STATUSES: ErrorStatusTable = [
  [ThemeValidationError, 400],
  [ThemeNotFoundError, 404],
  [ThemeApplyError, 422],
];

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
    return Response.json({
      builtIns: listBuiltInDesignPacks(),
      themes: await listThemes(projectPath),
    });
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}

export async function handleThemePost(
  projectPath: string,
  req: Request,
  expectedRevision?: string,
): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const operation = body.source === "built-in" ? applyBuiltInDesignPackFile : applyThemeFile;
    const { project, revision } = await operation(
      projectPath, body.id, {}, typeof body.layoutId === "string" ? body.layoutId : undefined,
      { expectedRevision },
    );
    return Response.json(project, { headers: { etag: `"${revision}"` } });
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}
