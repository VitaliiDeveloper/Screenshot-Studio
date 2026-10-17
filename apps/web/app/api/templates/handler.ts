// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import {
  createTemplateScreen,
  createBuiltInTemplateScreen,
  listBuiltInTemplates,
  listTemplates,
  TemplateCreateError,
  TemplateNotFoundError,
  TemplateValidationError,
} from "@screenshot-studio/cli/template-service";
import { errorResponseByClass, type ErrorStatusTable } from "@web/lib/project-request-fence.server.js";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";

async function loadStoreSpecs() {
  return parseStoreSpecs(JSON.parse(await readFile(resolveStoreSpecsPath(), "utf8")));
}

const ERROR_STATUSES: ErrorStatusTable = [
  [TemplateValidationError, 400],
  [TemplateNotFoundError, 404],
  [TemplateCreateError, 422],
];

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

export async function handleTemplateGet(projectPath: string): Promise<Response> {
  try {
    const specs = await loadStoreSpecs();
    const [templates, builtIns] = await Promise.all([
      listTemplates(projectPath),
      listBuiltInTemplates(projectPath, specs),
    ]);
    return Response.json({ templates, builtIns });
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}

export async function handleTemplatePost(
  projectPath: string,
  req: Request,
  expectedRevision?: string,
): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const layoutId = typeof body.layoutId === "string" ? body.layoutId : undefined;
    const result = body.source === "built-in"
      ? await createBuiltInTemplateScreen(
        projectPath,
        body.id,
        body.locale,
        await loadStoreSpecs(),
        {},
        layoutId,
        { expectedRevision },
      )
      : await createTemplateScreen(
        projectPath, body.id, body.locale, {}, layoutId, { expectedRevision }, await loadStoreSpecs(),
      );
    const { project, revision, screen } = result;
    return Response.json(
      { project, screenId: screen.id },
      { headers: { etag: `"${revision}"` } },
    );
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}
