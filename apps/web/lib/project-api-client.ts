// SPDX-License-Identifier: Apache-2.0
import {
  advanceProjectRevisionFromResponse,
  projectRequestHeaders,
} from "./save-project.js";
import { readJsonResponse } from "./json-response.js";

export interface ProjectJsonRequestOptions extends Omit<RequestInit, "headers"> {
  headers?: HeadersInit;
  conditional?: boolean;
  advanceRevision?: boolean;
  errorFallback: string;
  fetcher?: typeof fetch;
}

/** Shared transport for project-fenced JSON endpoints used by editor resource dialogs. */
export async function projectJsonRequest<T>(
  url: string,
  options: ProjectJsonRequestOptions,
): Promise<{ body: T; response: Response }> {
  const {
    conditional = false,
    advanceRevision = false,
    errorFallback,
    fetcher = fetch,
    headers,
    ...init
  } = options;
  const response = await fetcher(url, {
    ...init,
    headers: projectRequestHeaders({ conditional, headers }),
  });
  const body = await readJsonResponse(response, `${errorFallback} (${response.status})`) as T;
  if (advanceRevision) advanceProjectRevisionFromResponse(response);
  return { body, response };
}
