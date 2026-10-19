// SPDX-License-Identifier: Apache-2.0
import {
  projectLibraryService,
  type ProjectLibraryService,
} from "@web/lib/session/project-library.server.js";
import {
  serveProjectAssetPath,
  withPrivateAssetPolicy,
} from "@web/lib/project-asset.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

const ENTRY_ID_PATTERN = /^(?:project|recent)_[0-9a-f]{32}$/;

export async function handleProjectLibraryAssetGet(
  request: Request,
  service: Pick<ProjectLibraryService, "resolveProjectPath"> = projectLibraryService,
  serveAsset: typeof serveProjectAssetPath = serveProjectAssetPath,
): Promise<Response> {
  const url = new URL(request.url);
  const entryId = url.searchParams.get("entryId")?.trim();
  const relativePath = url.searchParams.get("path");
  const finish = (response: Response) => withPrivateAssetPolicy(response, true);
  if (!entryId || !ENTRY_ID_PATTERN.test(entryId) || !relativePath) {
    return finish(jsonError(400, "entryId and path are required"));
  }
  try {
    const projectPath = await service.resolveProjectPath(entryId);
    return finish(await serveAsset(projectPath, relativePath));
  } catch {
    return finish(jsonError(404, "project not found"));
  }
}
