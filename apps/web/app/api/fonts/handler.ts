// SPDX-License-Identifier: Apache-2.0
import {
  addGoogleFontMutation,
  addUploadedFontMutation,
  FontConflictError,
  FontInUseError,
  FontNotFoundError,
  FontValidationError,
  GoogleFontError,
  fontFamily,
  fontWeight,
  loadFontProject,
  MAX_FONT_BYTES,
  removeFontMutation,
  type FontServiceDependencies,
} from "@screenshot-studio/cli/font-service";
import { errorResponseByClass, type ErrorStatusTable } from "@web/lib/session/project-request-fence.server.js";

type UploadFile = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isUploadFile(value: FormDataEntryValue | null): value is File & UploadFile {
  return typeof value === "object"
    && value !== null
    && "name" in value
    && "size" in value
    && "arrayBuffer" in value;
}

export const ERROR_STATUSES: ErrorStatusTable = [
  [FontValidationError, 400],
  [FontConflictError, 409],
  [FontInUseError, 409],
  [FontNotFoundError, 404],
  [GoogleFontError, 422],
];

export function mutationResponse(
  result: { project: unknown; revision: string },
  status = 200,
): Response {
  return Response.json(result.project, {
    status,
    headers: { etag: `"${result.revision}"` },
  });
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new FontValidationError("request body must be a JSON object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new FontValidationError("request body must be a valid JSON object");
  }
}

export async function handleFontGet(projectPath: string): Promise<Response> {
  try {
    const project = await loadFontProject(projectPath);
    return Response.json({ fonts: project.fonts });
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}

export async function handleFontPost(
  projectPath: string,
  req: Request,
  dependencies: FontServiceDependencies = {},
  expectedRevision?: string,
): Promise<Response> {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!isUploadFile(file)) throw new FontValidationError("missing font file");
      if (file.size === 0) throw new FontValidationError("font file must not be empty");
      if (file.size > MAX_FONT_BYTES) throw new FontValidationError("font file must be 20 MB or smaller");
      const result = await addUploadedFontMutation(projectPath, {
        family: fontFamily(form.get("family")),
        weight: fontWeight(form.get("weight")),
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }, dependencies, { expectedRevision });
      return mutationResponse(result, 201);
    }

    const body = await jsonBody(req);
    if (body.source !== "google") throw new FontValidationError('source must be "google"');
    const result = await addGoogleFontMutation(projectPath, {
      family: fontFamily(body.family),
      weight: fontWeight(body.weight),
    }, dependencies, { expectedRevision });
    return mutationResponse(result, 201);
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}

export async function handleFontDelete(
  projectPath: string,
  req: Request,
  dependencies: FontServiceDependencies = {},
  expectedRevision?: string,
): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const result = await removeFontMutation(projectPath, {
      family: fontFamily(body.family),
      weight: fontWeight(body.weight),
    }, dependencies, { expectedRevision });
    return mutationResponse(result);
  } catch (error) {
    return errorResponseByClass(error, ERROR_STATUSES);
  }
}
