// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { handleExportProgressGet, handleExportStopPost } from "./handler.js";

const operationId = `export_${"ab".repeat(16)}`;

describe("GET /api/export/progress", () => {
  it("returns an uncached progress snapshot", async () => {
    const get = vi.fn(() => ({ operationId, phase: "rendering" as const, completed: 2, total: 4 }));
    const response = handleExportProgressGet(
      new Request(`http://localhost/api/export/progress?operationId=${operationId}`),
      { get },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ operationId, phase: "rendering", completed: 2, total: 4 });
  });

  it("distinguishes unknown and malformed operation ids", async () => {
    const missing = handleExportProgressGet(
      new Request(`http://localhost/api/export/progress?operationId=${operationId}`),
      { get: vi.fn(() => undefined) },
    );
    expect(missing.status).toBe(404);

    const malformed = handleExportProgressGet(
      new Request("http://localhost/api/export/progress?operationId=../escape"),
      { get: vi.fn(() => { throw new TypeError("Invalid export operation id"); }) },
    );
    expect(malformed.status).toBe(400);
  });
});

describe("POST /api/export/progress", () => {
  it("requests a stop only for a running export", async () => {
    const url = `http://localhost/api/export/progress?operationId=${operationId}`;
    const requestStop = vi.fn(() => true);
    expect(handleExportStopPost(new Request(url, { method: "POST" }), { requestStop }).status).toBe(202);
    expect(requestStop).toHaveBeenCalledWith(operationId);

    const finished = handleExportStopPost(new Request(url, { method: "POST" }), { requestStop: vi.fn(() => false) });
    expect(finished.status).toBe(404);
  });
});
