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
  removeFontMutation,
  type FontServiceDependencies,
} from "@screenshot-studio/cli/font-service";
import { resolveProjectPath } from "../../../lib/project-path.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof FontValidationError ? 400
    : error instanceof FontConflictError ? 409
      : error instanceof FontInUseError ? 409
      : error instanceof FontNotFoundError ? 404
        : error instanceof GoogleFontError ? 422
          : 500;
  return Response.json({ error: message }, { status });
}

function mutationResponse(
  result: { project: unknown; revision: string },
  status = 200,
): Response {
  return Response.json(result.project, {
    status,
    headers: { etag: `"${result.revision}"` },
  });
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
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

export async function handleFontGet(): Promise<Response> {
  try {
    const project = await loadFontProject(resolveProjectPath());
    return Response.json({ fonts: project.fonts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFontPost(
  req: Request,
  dependencies: FontServiceDependencies = {},
): Promise<Response> {
  try {
    const projectPath = resolveProjectPath();
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!isUploadFile(file)) throw new FontValidationError("missing font file");
      if (file.size === 0) throw new FontValidationError("font file must not be empty");
      if (file.size > MAX_UPLOAD_BYTES) throw new FontValidationError("font file must be 20 MB or smaller");
      const result = await addUploadedFontMutation(projectPath, {
        family: fontFamily(form.get("family")),
        weight: fontWeight(form.get("weight")),
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }, dependencies);
      return mutationResponse(result, 201);
    }

    const body = await jsonBody(req);
    if (body.source !== "google") throw new FontValidationError('source must be "google"');
    const result = await addGoogleFontMutation(projectPath, {
      family: fontFamily(body.family),
      weight: fontWeight(body.weight),
    }, dependencies);
    return mutationResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFontDelete(
  req: Request,
  dependencies: FontServiceDependencies = {},
): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const result = await removeFontMutation(resolveProjectPath(), {
      family: fontFamily(body.family),
      weight: fontWeight(body.weight),
    }, dependencies);
    return mutationResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
