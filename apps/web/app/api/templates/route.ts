// SPDX-License-Identifier: Apache-2.0
import { handleTemplateGet, handleTemplatePost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleTemplateGet();
}

export async function POST(req: Request): Promise<Response> {
  return handleTemplatePost(req);
}
