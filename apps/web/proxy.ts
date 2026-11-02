// SPDX-License-Identifier: Apache-2.0
import { rejectForeignApiRequest } from "@web/lib/api-request-guard.server.js";

export function proxy(req: Request): Response | undefined {
  return rejectForeignApiRequest(req);
}

export const config = { matcher: "/api/:path*" };
