// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "./command-dispatch.js";
import {
  ensureRenderBrowsers,
  installHelp,
  listInstallLocations,
  isMissingChannelError,
  isMissingChromiumError,
  launchOrder,
  parseInstallLocations,
  resolveBrowserChoice,
  resolvePlaywrightInstall,
  systemChannels,
  runSetupCommand,
  type BrowserSetupDependencies,
} from "./browser-setup.js";

const DRY_RUN = `Chrome for Testing 151.0.1 (playwright chromium v1234)
  Install location:    /cache/ms-playwright/chromium-1234
  Download url:        https://cdn.playwright.dev/chromium.zip

FFmpeg (playwright ffmpeg v1011)
  Install location:    /cache/ms-playwright/ffmpeg-1011
  Download url:        https://cdn.playwright.dev/ffmpeg.zip

Chrome Headless Shell 151.0.1 (playwright chromium-headless-shell v1234)
  Install location:    /cache/ms-playwright/chromium_headless_shell-1234
`;

function deps(overrides: Partial<BrowserSetupDependencies> = {}): BrowserSetupDependencies {
  return {
    interactive: true,
    playwrightVersion: "9.9.9",
    detect: () => ({ missing: true, cacheDir: "/cache/ms-playwright" }),
    hasSystemBrowser: vi.fn(async () => false),
    install: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    log: vi.fn(),
    ...overrides,
  };
}

describe("install location detection", () => {
  it("reads browser install locations from the dry run and skips FFmpeg", () => {
    expect(parseInstallLocations(DRY_RUN)).toEqual([
      "/cache/ms-playwright/chromium-1234",
      "/cache/ms-playwright/chromium_headless_shell-1234",
    ]);
  });

  it("returns nothing for unrecognised output", () => {
    expect(parseInstallLocations("nothing useful")).toEqual([]);
  });

  it("honours PLAYWRIGHT_BROWSERS_PATH against the real Playwright dry run without downloading", () => {
    const cache = mkdtempSync(join(tmpdir(), "browser-setup-"));
    try {
      const locations = listInstallLocations(resolvePlaywrightInstall(), {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: cache,
      });
      expect(locations).toHaveLength(2);
      // Compare the leaf only: Windows runners may expand 8.3 short names in the parent path.
      for (const location of locations) expect(basename(dirname(location))).toBe(basename(cache));
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("pins the installer to the Playwright version the CLI depends on", () => {
    expect(resolvePlaywrightInstall().version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("ensureRenderBrowsers", () => {
  it("does nothing when the browsers are present", async () => {
    const d = deps({ detect: () => ({ missing: false }) });
    await ensureRenderBrowsers("required", d);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.install).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  it("describes the download, installs after confirmation, then continues", async () => {
    const d = deps();
    await ensureRenderBrowsers("required", d);
    const shown = vi.mocked(d.log).mock.calls.map(([message]) => message).join("\n");
    expect(shown).toContain("Chromium");
    expect(shown).toContain("550 MB");
    expect(shown).toContain("/cache/ms-playwright");
    expect(shown).toContain("9.9.9");
    expect(d.confirm).toHaveBeenCalledOnce();
    expect(d.install).toHaveBeenCalledOnce();
  });

  it("fails with the install command and Linux note when an interactive user declines", async () => {
    const d = deps({ confirm: vi.fn(async () => false) });
    await expect(ensureRenderBrowsers("required", d)).rejects.toThrow(installHelp("9.9.9"));
    expect(d.install).not.toHaveBeenCalled();
  });

  it("never downloads or prompts without a TTY and fails with the exact commands", async () => {
    const d = deps({ interactive: false });
    const failure = ensureRenderBrowsers("required", d);
    await expect(failure).rejects.toThrow("screenshots setup");
    await expect(failure).rejects.toThrow("pnpm dlx playwright@9.9.9 install chromium chromium-headless-shell");
    await expect(failure).rejects.toThrow(/On Linux, Chromium may also need system packages/);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.install).not.toHaveBeenCalled();
  });

  it("lets optional commands continue with a warning instead of failing", async () => {
    const nonInteractive = deps({ interactive: false });
    await expect(ensureRenderBrowsers("optional", nonInteractive)).resolves.toBeUndefined();
    expect(nonInteractive.install).not.toHaveBeenCalled();
    expect(vi.mocked(nonInteractive.log).mock.calls.join("\n")).toContain("screenshots setup");

    const declined = deps({ confirm: vi.fn(async () => false) });
    await expect(ensureRenderBrowsers("optional", declined)).resolves.toBeUndefined();
    expect(declined.install).not.toHaveBeenCalled();
  });

  it("surfaces an installer failure", async () => {
    const d = deps({ install: vi.fn(async () => { throw new Error("download failed"); }) });
    await expect(ensureRenderBrowsers("required", d)).rejects.toThrow("download failed");
  });
});

describe("setup command", () => {
  afterEach(() => vi.restoreAllMocks());

  it("installs without prompting, even without a TTY", async () => {
    const d = deps({ interactive: false });
    await runSetupCommand(d);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.install).toHaveBeenCalledOnce();
  });

  it("is idempotent when the browsers are already installed", async () => {
    const d = deps({ detect: () => ({ missing: false }) });
    await runSetupCommand(d);
    await runSetupCommand(d);
    expect(d.install).toHaveBeenCalledTimes(2);
  });

  it("is dispatched as `setup` and rejects flags", async () => {
    const d = deps();
    await dispatchCommand("setup", [], { storeSpecsPath: "/store-specs.json", browserSetup: d });
    expect(d.install).toHaveBeenCalledOnce();
    await expect(dispatchCommand("setup", ["--x"], { storeSpecsPath: "/s.json", browserSetup: d }))
      .rejects.toThrow(/Unknown option --x/);
  });

  it("guards export before any project work and keeps other commands browser-free", async () => {
    const d = deps({ interactive: false });
    await expect(dispatchCommand("export", [], { storeSpecsPath: "/s.json", browserSetup: d }))
      .rejects.toThrow("screenshots setup");
    expect(d.install).not.toHaveBeenCalled();
    const detect = vi.fn(() => ({ missing: true }));
    await expect(dispatchCommand("theme", [], { storeSpecsPath: "/s.json", browserSetup: deps({ detect }) }))
      .rejects.not.toThrow("screenshots setup");
    expect(detect).not.toHaveBeenCalled();
  });
});

describe("browser choice", () => {
  it("defaults to the downloaded Chromium so system browsers stay opt-in", () => {
    expect(resolveBrowserChoice(undefined, {})).toBe("chromium");
    expect(resolveBrowserChoice("", { SCREENSHOTS_BROWSER: "" })).toBe("chromium");
  });

  it("lets the flag win over SCREENSHOTS_BROWSER", () => {
    expect(resolveBrowserChoice(undefined, { SCREENSHOTS_BROWSER: "msedge" })).toBe("msedge");
    expect(resolveBrowserChoice("chromium", { SCREENSHOTS_BROWSER: "msedge" })).toBe("chromium");
  });

  it("rejects unknown values from either source", () => {
    expect(() => resolveBrowserChoice("firefox", {})).toThrow(/Unknown browser "firefox".*chromium, chrome, msedge, auto/);
    expect(() => resolveBrowserChoice(undefined, { SCREENSHOTS_BROWSER: "webkit" })).toThrow(/Unknown browser "webkit"/);
  });

  it("orders system browsers chrome, msedge for auto and none for chromium", () => {
    expect(systemChannels("auto")).toEqual(["chrome", "msedge"]);
    expect(systemChannels("msedge")).toEqual(["msedge"]);
    expect(systemChannels("chromium")).toEqual([]);
  });

  it("recognises Playwright's missing-channel error", () => {
    expect(isMissingChannelError(new Error("browserType.launch: Chromium distribution 'chrome' is not found at /x"))).toBe(true);
    expect(isMissingChannelError(new Error("Executable doesn't exist"))).toBe(false);
    expect(isMissingChannelError("distribution 'chrome' is not found")).toBe(false);
  });

  it("recognises Playwright's missing-Chromium error", () => {
    expect(isMissingChromiumError(new Error("browserType.launch: Executable doesn't exist at /cache/chromium"))).toBe(true);
    expect(isMissingChromiumError(new Error("browser crashed"))).toBe(false);
  });

  it("orders launch attempts so only auto falls through, Chromium first", () => {
    expect(launchOrder("auto")).toEqual([undefined, "chrome", "msedge"]);
    expect(launchOrder("chromium")).toEqual([undefined]);
    expect(launchOrder("chrome")).toEqual(["chrome"]);
  });

  it("still finds the error wording in the pinned Playwright", () => {
    const bundle = readFileSync(
      join(dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), "lib", "coreBundle.js"),
      "utf8",
    );
    expect(bundle).toContain("distribution '${name}' is not found");
    expect(bundle).toContain("Executable doesn't exist");
  });

  describe("ensureRenderBrowsers with a system browser", () => {
    it("skips the Chromium check entirely for an explicit chrome or msedge", async () => {
      const d = deps({ interactive: false });
      await ensureRenderBrowsers("required", d, "chrome");
      await ensureRenderBrowsers("required", d, "msedge");
      expect(d.hasSystemBrowser).not.toHaveBeenCalled();
    });

    it("auto passes without a download when a system browser exists", async () => {
      const d = deps({ interactive: false, hasSystemBrowser: vi.fn(async () => true) });
      await ensureRenderBrowsers("required", d, "auto");
      expect(d.install).not.toHaveBeenCalled();
    });

    it("auto without a system browser fails exactly like chromium", async () => {
      const d = deps({ interactive: false });
      const auto = await ensureRenderBrowsers("required", d, "auto").catch((e: Error) => e.message);
      const plain = await ensureRenderBrowsers("required", d).catch((e: Error) => e.message);
      expect(auto).toBe(plain);
      expect(auto).toContain(installHelp("9.9.9"));
    });

    it("chromium never probes for system browsers", async () => {
      const d = deps({ interactive: false });
      await expect(ensureRenderBrowsers("required", d, "chromium")).rejects.toThrow("screenshots setup");
      expect(d.hasSystemBrowser).not.toHaveBeenCalled();
    });

    it("dispatches --browser and SCREENSHOTS_BROWSER to the guard", async () => {
      const guarded = () => deps({ interactive: false, detect: vi.fn(() => ({ missing: true })) });
      const run = (argv: string[], d: BrowserSetupDependencies) =>
        dispatchCommand("export", argv, { storeSpecsPath: "/s.json", browserSetup: d });

      await expect(run(["--browser", "firefox"], guarded())).rejects.toThrow(/Unknown browser "firefox"/);

      // chrome skips the guard, so neither detection runs and failure moves on to project resolution.
      const flagged = guarded();
      await expect(run(["--browser", "chrome"], flagged)).rejects.not.toThrow("screenshots setup");
      expect(flagged.detect).not.toHaveBeenCalled();
      expect(flagged.hasSystemBrowser).not.toHaveBeenCalled();

      vi.stubEnv("SCREENSHOTS_BROWSER", "msedge");
      try {
        const fromEnv = guarded();
        await expect(run([], fromEnv)).rejects.not.toThrow("screenshots setup");
        expect(fromEnv.detect).not.toHaveBeenCalled();

        const overridden = guarded();
        await expect(run(["--browser", "chromium"], overridden)).rejects.toThrow("screenshots setup");
        expect(overridden.detect).toHaveBeenCalledOnce();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
