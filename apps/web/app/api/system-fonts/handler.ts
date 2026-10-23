// SPDX-License-Identifier: Apache-2.0
import {
  addUploadedFontMutation,
  FontValidationError,
  type FontServiceDependencies,
} from "@screenshot-studio/cli/font-service";
import {
  SystemFontNotFoundError,
  SystemFontUnavailableError,
} from "@screenshot-studio/cli/system-fonts";
import { sharedSystemFontScanner } from "@web/lib/system-fonts.server.js";
import { errorResponseByClass, type ErrorStatusTable } from "@web/lib/session/project-request-fence.server.js";
import { ERROR_STATUSES as FONT_ERROR_STATUSES, jsonBody, mutationResponse } from "@web/app/api/fonts/handler.js";

export const SYSTEM_FONTS_LOCAL_ONLY = "System fonts are only available from localhost";

const ERROR_STATUSES: ErrorStatusTable = [
  [SystemFontNotFoundError, 404],
  [SystemFontUnavailableError, 422],
  ...FONT_ERROR_STATUSES,
];

function previewId(req: Request): string {
  const params = new URL(req.url).searchParams;
  const ids = params.getAll("id");
  if ([...params.keys()].some((key) => key !== "id") || ids.length !== 1 || !ids[0]) {
    throw new FontValidationError("exactly one id query parameter is required");
  }
  return ids[0];
}

async function importId(req: Request): Promise<string> {
  const body = await jsonBody(req);
  if (Object.keys(body).length !== 1 || typeof body.id !== "string" || !body.id) {
    throw new FontValidationError('request body must be exactly {"id": string}');
  }
  return body.id;
}

export async function handleSystemFontsGet(): Promise<Response> {
  try {
    const fonts = await sharedSystemFontScanner().list();
    return Response.json({ fonts }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}

export async function handleSystemFontPreview(req: Request): Promise<Response> {
  try {
    const { bytes } = await sharedSystemFontScanner().read(previewId(req));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}

export async function handleSystemFontImport(
  projectPath: string,
  req: Request,
  dependencies: FontServiceDependencies = {},
  expectedRevision?: string,
): Promise<Response> {
  try {
    const { face, fileName, bytes } = await sharedSystemFontScanner().read(await importId(req));
    const result = await addUploadedFontMutation(projectPath, {
      family: face.family,
      weight: face.weight!,
      filename: fileName,
      bytes,
    }, dependencies, { expectedRevision });
    return mutationResponse(result, 201);
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}
