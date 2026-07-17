// SPDX-License-Identifier: Apache-2.0
import { handleProjectSessionGet, handleProjectSessionPost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleProjectSessionGet;
export const POST = handleProjectSessionPost;
