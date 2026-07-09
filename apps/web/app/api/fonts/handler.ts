import {
  addGoogleFont,
  addUploadedFont,
  FontConflictError,
  FontNotFoundError,
  FontValidationError,
  GoogleFontError,
  fontFamily,
  fontWeight,
  loadFontProject,
  removeFont,
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
      : error instanceof FontNotFoundError ? 404
        : error instanceof GoogleFontError ? 422
          : 500;
  return Response.json({ error: message }, { status });
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    throw new FontValidationError("request body must be valid JSON");
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
      const project = await addUploadedFont(projectPath, {
        family: fontFamily(form.get("family")),
        weight: fontWeight(form.get("weight")),
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return Response.json(project, { status: 201 });
    }

    const body = await jsonBody(req);
    if (body.source !== "google") throw new FontValidationError('source must be "google"');
    const project = await addGoogleFont(projectPath, {
      family: fontFamily(body.family),
      weight: fontWeight(body.weight),
    }, dependencies);
    return Response.json(project, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFontDelete(req: Request): Promise<Response> {
  try {
    const body = await jsonBody(req);
    const project = await removeFont(resolveProjectPath(), {
      family: fontFamily(body.family),
      weight: fontWeight(body.weight),
    });
    return Response.json(project);
  } catch (error) {
    return errorResponse(error);
  }
}
