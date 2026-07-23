// SPDX-License-Identifier: Apache-2.0
import {
  importProjectImageMutation,
  MAX_PROJECT_IMAGE_BYTES,
  ProjectImageValidationError,
  type ProjectImageServiceDependencies,
} from "@screenshot-studio/cli/project-image-service";
import { projectRevisionConflictResponse } from "@web/lib/project-request-fence.server.js";

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
  const revisionConflict = projectRevisionConflictResponse(error);
  if (revisionConflict) return revisionConflict;
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, {
    status: error instanceof ProjectImageValidationError ? 400 : 500,
  });
}

export async function handleAssetPost(
  projectPath: string,
  req: Request,
  dependencies: ProjectImageServiceDependencies = {},
  expectedRevision?: string,
): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!isUploadFile(file)) throw new ProjectImageValidationError("Missing image file");
    if (file.size === 0) throw new ProjectImageValidationError("Image file must not be empty");
    if (file.size > MAX_PROJECT_IMAGE_BYTES) {
      throw new ProjectImageValidationError("Image file must be 25 MB or smaller");
    }

    const result = await importProjectImageMutation(projectPath, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }, dependencies, { expectedRevision });

    return Response.json({ asset: result.asset }, {
      status: 201,
      headers: { etag: `"${result.revision}"` },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
