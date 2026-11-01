// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { GET } from "./route.js";

describe("GET /api/instance", () => {
  it("identifies the host to the CLI launcher without caching", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ app: "screenshot-studio" });
  });
});
