// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  readJsonBody,
  readJsonResponse,
  responseError,
  responseErrorMessage,
} from "./json-response.js";

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("json-response", () => {
  it.each(["not json", "null", "[1, 2]", "\"text\""])("reads %s as an empty record", async (body) => {
    expect(await readJsonBody(textResponse(body))).toEqual({});
  });

  it("uses the server error string and otherwise the fallback", () => {
    expect(responseErrorMessage({ error: "Nope" }, "Fallback")).toBe("Nope");
    expect(responseErrorMessage({ error: 42 }, "Fallback")).toBe("Fallback");
    expect(responseErrorMessage({}, "Fallback")).toBe("Fallback");
  });

  it("returns the body of an ok response", async () => {
    expect(await readJsonResponse(textResponse('{"value":1}'), "Fallback")).toEqual({ value: 1 });
  });

  it("throws the server message, or the fallback, for a failed response", async () => {
    await expect(readJsonResponse(textResponse('{"error":"Locked"}', 409), "Fallback"))
      .rejects.toThrow("Locked");
    await expect(readJsonResponse(textResponse("null", 500), "Request failed (500)"))
      .rejects.toThrow("Request failed (500)");
    expect((await responseError(textResponse("{}", 404), "Missing")).message).toBe("Missing");
  });
});
