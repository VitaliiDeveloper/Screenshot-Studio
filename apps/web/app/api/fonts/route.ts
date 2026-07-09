import { handleFontDelete, handleFontGet, handleFontPost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleFontGet();
}

export async function POST(req: Request): Promise<Response> {
  return handleFontPost(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handleFontDelete(req);
}
