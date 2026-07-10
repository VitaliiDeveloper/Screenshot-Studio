// SPDX-License-Identifier: Apache-2.0
import { handleThemeGet, handleThemePost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleThemeGet();
}

export async function POST(req: Request): Promise<Response> {
  return handleThemePost(req);
}
