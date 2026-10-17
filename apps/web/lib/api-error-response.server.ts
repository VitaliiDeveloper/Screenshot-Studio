// SPDX-License-Identifier: Apache-2.0

/**
 * The one error shape of every `/api/*` route: `{ error, code? }`, never cached. `code` is set only
 * where a client branches on it; `details` carries endpoint-specific fields such as
 * `missingResources`.
 */
export function jsonError(
  status: number,
  error: string,
  code?: string,
  details: Record<string, unknown> = {},
): Response {
  return Response.json(
    { error, ...(code === undefined ? {} : { code }), ...details },
    { status, headers: { "cache-control": "no-store" } },
  );
}
