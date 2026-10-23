// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { createRenderBrowserSession, renderScreenToPng } from "./render-driver.js";

describe("RenderBrowserSession", () => {
  it("retains a one-shot render failure when session cleanup also fails", async () => {
    const renderError = new Error("render failed");
    const closeError = new Error("session close failed");
    const session = {
      renderScreenToPng: vi.fn(async () => { throw renderError; }),
      close: vi.fn(async () => { throw closeError; }),
    };

    await expect(renderScreenToPng({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      layoutId: "default",
      screenId: "s1",
      pixelRatio: 1,
    }, { createSession: vi.fn(async () => session) })).rejects.toMatchObject({
      errors: [renderError, closeError],
      cause: renderError,
    });
  });

  it("retains a falsy one-shot render failure when session cleanup fails", async () => {
    const closeError = new Error("session close failed");
    const session = {
      renderScreenToPng: vi.fn(async () => { throw undefined; }),
      close: vi.fn(async () => { throw closeError; }),
    };

    await expect(renderScreenToPng({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      layoutId: "default",
      screenId: "s1",
      pixelRatio: 1,
    }, { createSession: vi.fn(async () => session) })).rejects.toMatchObject({
      errors: [undefined, closeError],
      cause: undefined,
    });
  });

  it("launches headed and headless sessions with the same font render hinting", async () => {
    const browser = {
      newContext: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
      close: vi.fn(async () => undefined),
    };
    const launch = vi.fn(async (_options?: unknown) => browser as never);

    await (await createRenderBrowserSession({ launch })).close();
    await (await createRenderBrowserSession({ headless: false, launch })).close();

    expect(launch.mock.calls.map(([options]) => options)).toEqual([
      { headless: true, args: ["--font-render-hinting=slight"] },
      { headless: false, args: ["--font-render-hinting=slight"] },
    ]);
  });

  it("pins the render URL and fails fast on a server-rendered revision error", async () => {
    const errorNode: {
      count: ReturnType<typeof vi.fn>;
      first: ReturnType<typeof vi.fn>;
      textContent: ReturnType<typeof vi.fn>;
    } = {
      count: vi.fn(async () => 1),
      first: vi.fn(),
      textContent: vi.fn(async () => "Project revision changed before render"),
    };
    errorNode.first.mockReturnValue(errorNode);
    const page = {
      goto: vi.fn(async () => undefined),
      locator: vi.fn(() => errorNode),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(),
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
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });

    await expect(session.renderScreenToPng({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      projectRevision: "a".repeat(64),
      layoutId: "default",
      screenId: "s1",
      pixelRatio: 1,
    })).rejects.toThrow(/s1.*revision changed/i);

    expect(page.goto).toHaveBeenCalledWith(
      expect.stringMatching(/\/render\?.*revision=a{64}/),
      expect.any(Object),
    );
    expect(page.waitForFunction).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("reuses one browser context across multiple renders", async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
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
        layoutId: "default",
        screenId: "s1",
        pixelRatio: 1,
      }),
    ).resolves.toEqual(Buffer.from("first"));
    await expect(
      session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        layoutId: "default",
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
      locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
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
        layoutId: "default",
        screenId: "s1",
        pixelRatio: 1,
      }),
    ).rejects.toThrow(/s1.*bad project/);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("retains the render failure when page cleanup also fails", async () => {
    const page = {
      goto: vi.fn(async () => { throw new Error("navigation failed"); }),
      locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(),
      close: vi.fn(async () => { throw new Error("page close failed"); }),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });

    await expect(session.renderScreenToPng({
      baseUrl: "http://localhost:4000",
      projectPath: "fixtures/project.json",
      layoutId: "default",
      screenId: "s1",
      pixelRatio: 1,
    })).rejects.toThrow(/navigation failed.*page cleanup failed.*page close failed/);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("preserves a falsy render failure", async () => {
    const page = {
      goto: vi.fn(async () => { throw undefined; }),
      locator: vi.fn(() => ({ count: vi.fn(async () => 0) })),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });
    let rejected = false;

    try {
      await session.renderScreenToPng({
        baseUrl: "http://localhost:4000",
        projectPath: "fixtures/project.json",
        layoutId: "default",
        screenId: "s1",
        pixelRatio: 1,
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }

    expect(rejected).toBe(true);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser even when context cleanup fails", async () => {
    const context = {
      newPage: vi.fn(),
      close: vi.fn(async () => { throw new Error("context close failed"); }),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });

    await expect(session.close()).rejects.toThrow(/context close failed/);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("preserves a falsy context cleanup failure", async () => {
    const context = {
      newPage: vi.fn(),
      close: vi.fn(async () => { throw undefined; }),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };
    const session = await createRenderBrowserSession({ launch: vi.fn(async () => browser as never) });
    let rejected = false;

    try {
      await session.close();
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }

    expect(rejected).toBe(true);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when context creation fails", async () => {
    const browser = {
      newContext: vi.fn(async () => { throw new Error("context creation failed"); }),
      close: vi.fn(async () => undefined),
    };

    await expect(createRenderBrowserSession({
      launch: vi.fn(async () => browser as never),
    })).rejects.toThrow(/context creation failed/);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
