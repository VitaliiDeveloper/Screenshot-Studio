// SPDX-License-Identifier: Apache-2.0

/** A response's JSON body as a record; an unreadable or non-object body reads as `{}`. */
export async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** The server's `{ error }` message when it sent one, otherwise `fallback`. */
export function responseErrorMessage(body: { error?: unknown }, fallback: string): string {
  return typeof body.error === "string" ? body.error : fallback;
}

/** The error for a failed response whose body is not otherwise needed. */
export async function responseError(response: Response, fallback: string): Promise<Error> {
  return new Error(responseErrorMessage(await readJsonBody(response), fallback));
}

/** Reads the JSON body once; a failed response throws its `error` message or `fallback`. */
export async function readJsonResponse(
  response: Response,
  fallback: string,
): Promise<Record<string, unknown>> {
  const body = await readJsonBody(response);
  if (!response.ok) throw new Error(responseErrorMessage(body, fallback));
  return body;
}
