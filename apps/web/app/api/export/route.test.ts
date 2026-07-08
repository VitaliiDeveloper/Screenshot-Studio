import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POST } from "./route.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const fixture = resolve(repoRoot, "fixtures/phase-2-bundle/app-store-screenshots.json");

function req(body: unknown): Request {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.PROJECT_PATH;
});

describe("POST /api/export", () => {
  it("returns 422 without rendering when filters match no screens", async () => {
    process.env.PROJECT_PATH = fixture;
    const res = await POST(req({ locale: "does-not-exist" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No screens match/);
  });
});
