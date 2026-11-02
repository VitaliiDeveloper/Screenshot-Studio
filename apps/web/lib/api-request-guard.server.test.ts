// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { rejectForeignApiRequest } from "./api-request-guard.server.js";

function request(method: string, headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/project-import", { method, headers });
}

async function refusal(req: Request): Promise<{ status: number; error: unknown } | undefined> {
  const response = rejectForeignApiRequest(req);
  return response && { status: response.status, error: ((await response.json()) as { error: unknown }).error };
}

describe("rejectForeignApiRequest", () => {
  it.each(["GET", "POST"])("refuses a %s under a rebound non-loopback Host", async (method) => {
    expect(await refusal(request(method, { host: "rebound.example:3000" }))).toEqual({
      status: 403,
      error: "The editor API is only available from localhost",
    });
  });

  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["another localhost port", { origin: "http://127.0.0.1:5173" }],
    ["a sandboxed null Origin", { origin: "null" }],
    ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
    ["a same-site fetch", { "sec-fetch-site": "same-site" }],
  ])("refuses a state-changing request from %s", async (_name, headers) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await refusal(request(method, { host: "127.0.0.1:3000", ...headers }))).toEqual({
        status: 403,
        error: "Cross-site requests to the editor API are refused",
      });
    }
  });

  it.each([
    ["the same-origin editor", { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }],
    ["the editor at localhost", { host: "localhost:3000", origin: "http://LOCALHOST:3000" }],
    ["the CLI or Playwright without an Origin", {}],
    ["IPv6 loopback", { host: "[::1]:3000", origin: "http://[::1]:3000" }],
  ])("allows a write from %s", (_name, headers) => {
    expect(rejectForeignApiRequest(request("POST", { host: "127.0.0.1:3000", ...headers }))).toBeUndefined();
  });

  it("allows a read with a foreign Origin only under a loopback Host", () => {
    const headers = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    expect(rejectForeignApiRequest(request("GET", { host: "localhost:3000", ...headers }))).toBeUndefined();
    expect(rejectForeignApiRequest(request("GET", { host: "evil.example", ...headers }))?.status).toBe(403);
  });
});
