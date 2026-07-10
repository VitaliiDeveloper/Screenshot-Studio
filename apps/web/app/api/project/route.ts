// SPDX-License-Identifier: Apache-2.0
import { LocalFileStorageAdapter } from "@screenshot-studio/core/storage";
import { parseProject, ProjectValidationError } from "@screenshot-studio/core/model";
import { dirname } from "node:path";
import { resolveProjectPath } from "../../../lib/project-path.js";

/**
 * The editor's only persistence channel (spec §5): the browser reads/writes the same on-disk
 * app-store-screenshots.json the CLI and /render use, via LocalFileStorageAdapter. PUT validates
 * with the same strict core loader before writing — an invalid project is rejected, never saved.
 * Dev-only, local, self-hosted; arbitrary local file read is acceptable here (same as /render).
 */
export const dynamic = "force-dynamic";

function adapter(path: string): LocalFileStorageAdapter {
  return new LocalFileStorageAdapter(dirname(path));
}

export async function GET(): Promise<Response> {
  const path = resolveProjectPath();
  try {
    const project = await adapter(path).load(path);
    return Response.json(project);
  } catch (err) {
    const status = err instanceof ProjectValidationError ? 422 : 404;
    return Response.json({ error: (err as Error).message }, { status });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const path = resolveProjectPath();
  let project;
  try {
    project = parseProject(await req.json());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  await adapter(path).save(project, path);
  return Response.json({ ok: true });
}
