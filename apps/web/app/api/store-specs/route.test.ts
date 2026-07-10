// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { GET } from "./route.js";

describe("GET /api/store-specs", () => {
  it("returns parsed store specs including the iphone lead size", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apple.iphone.some((s: { id: string }) => s.id === "6.9")).toBe(true);
  });
});
