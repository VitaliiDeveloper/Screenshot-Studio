// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { waitForHttp } from "./render-host-readiness.js";

describe("waitForHttp", () => {
  it("gives up on a listener that accepts but never answers", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    }));

    await expect(waitForHttp("http://localhost:4571", 150, fetchImpl as typeof fetch))
      .rejects.toThrow(/did not become ready within 150ms/);
  }, 2_000);

  it("waits for the instance route instead of any answer", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("other program", { status: 404 }))
      .mockResolvedValueOnce(new Response("<!doctype html><title>Other dev server</title>"))
      .mockResolvedValueOnce(Response.json({ app: "screenshot-studio" }));

    await waitForHttp("http://localhost:4572", 2_000, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenLastCalledWith("http://localhost:4572/api/instance", expect.anything());
  });
});
