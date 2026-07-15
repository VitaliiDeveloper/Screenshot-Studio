// SPDX-License-Identifier: Apache-2.0
import { handleExportArtifactGet } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  return handleExportArtifactGet(token);
}
