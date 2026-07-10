// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { createRenderBrowserSession } from "./render-driver.js";

describe("RenderBrowserSession", () => {
  it("reuses one browser context across multiple renders", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("data:image/png;base64,Zmlyc3Q=")
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("data:image/png;base64,c2Vjb25k"),
      close: vi.fn(async () => undefined),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };
    const session = await createRenderBrowserSession({
      launch: vi.fn(async () => browser as never),
    });

    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        screenId: "s1",
        pixelRatio: 1,
      }),
    ).resolves.toEqual(Buffer.from("first"));
    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        screenId: "s2",
        pixelRatio: 2,
      }),
    ).resolves.toEqual(Buffer.from("second"));

    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(page.close).toHaveBeenCalledTimes(2);
    await session.close();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("surfaces browser render errors with the screen id", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn().mockResolvedValueOnce("bad project"),
      close: vi.fn(async () => undefined),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });
    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        screenId: "s1",
        pixelRatio: 1,
      }),
    ).rejects.toThrow(/s1.*bad project/);
    expect(page.close).toHaveBeenCalledTimes(1);
  });
});
