// SPDX-License-Identifier: Apache-2.0
import { handleExportArtifactGet } from "@web/app/api/export/artifacts/[token]/handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  return handleExportArtifactGet(token);
}
