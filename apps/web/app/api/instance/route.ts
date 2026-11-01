// SPDX-License-Identifier: Apache-2.0

/**
 * Lets the `screenshots` launcher tell a running Screenshot Studio host from another program on its
 * port, so a second launch reuses the host instead of starting one. The CLI matches `app` exactly.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ app: "screenshot-studio" }, { headers: { "cache-control": "no-store" } });
}
