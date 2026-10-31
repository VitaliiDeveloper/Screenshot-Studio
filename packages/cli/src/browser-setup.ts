// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";

/**
 * First-run Chromium setup. Playwright keeps its browsers in a shared per-user cache that the
 * npm package cannot ship (and we deliberately avoid `postinstall` downloads), so the CLI detects
 * missing builds before the render host launches and installs them only with explicit consent.
 * The installer is the Playwright copy the CLI already depends on: no `@latest`, no version drift.
 */

const BROWSERS = ["chromium", "chromium-headless-shell"] as const;
const APPROX_DISK_USAGE = "about 550 MB";
const SYSTEM_PACKAGES_URL = "https://playwright.dev/docs/browsers#install-system-dependencies";

export const BROWSER_CHOICES = ["chromium", "chrome", "msedge", "auto"] as const;
export type BrowserChoice = (typeof BROWSER_CHOICES)[number];
export type SystemChannel = "chrome" | "msedge";

/** `auto` is opt-in: system browsers are not parity-checked, so the default stays the pinned Chromium. */
export const DEFAULT_BROWSER_CHOICE: BrowserChoice = "chromium";

/** `--browser` wins over `SCREENSHOTS_BROWSER`; an empty value counts as unset. */
export function resolveBrowserChoice(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BrowserChoice {
  const value = flag || env.SCREENSHOTS_BROWSER;
  if (!value) return DEFAULT_BROWSER_CHOICE;
  if (!(BROWSER_CHOICES as readonly string[]).includes(value)) {
    throw new Error(`Unknown browser "${value}". Use one of: ${BROWSER_CHOICES.join(", ")}`);
  }
  return value as BrowserChoice;
}

/** System browsers to try, in order, before the downloaded Chromium. */
export function systemChannels(choice: BrowserChoice): SystemChannel[] {
  if (choice === "auto") return ["chrome", "msedge"];
  return choice === "chromium" ? [] : [choice];
}

/** Playwright throws "Chromium distribution '<channel>' is not found at <path>" for an absent channel. */
export function isMissingChannelError(error: unknown): boolean {
  return error instanceof Error && /distribution '[^']+' is not found/.test(error.message);
}

export interface PlaywrightInstall {
  version: string;
  cliPath: string;
}

export function resolvePlaywrightInstall(): PlaywrightInstall {
  const manifestPath = createRequire(import.meta.url).resolve("playwright/package.json");
  const { version } = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
  return { version, cliPath: join(dirname(manifestPath), "cli.js") };
}

/** Install directories from `playwright install --dry-run` output; FFmpeg (video only) is skipped. */
export function parseInstallLocations(dryRunOutput: string): string[] {
  const locations: string[] = [];
  let title = "";
  for (const line of dryRunOutput.split(/\r?\n/)) {
    const location = /^\s+Install location:\s+(.+?)\s*$/.exec(line);
    if (location) {
      if (!/^ffmpeg/i.test(title)) locations.push(location[1]!);
    } else if (line && !/^\s/.test(line)) {
      title = line;
    }
  }
  return locations;
}

/** Empty when the dry run cannot be read, which detection treats as "nothing known to be missing". */
export function listInstallLocations(
  playwright: PlaywrightInstall,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const result = spawnSync(process.execPath, [playwright.cliPath, "install", "--dry-run", ...BROWSERS], {
    encoding: "utf8",
    env,
  });
  return result.status === 0 ? parseInstallLocations(result.stdout) : [];
}

export interface BrowserStatus {
  missing: boolean;
  /** Playwright's shared browser cache directory, when it could be determined. */
  cacheDir?: string;
}

export interface BrowserSetupDependencies {
  interactive: boolean;
  playwrightVersion: string;
  detect: () => BrowserStatus;
  /** True when a system browser for `auto` can be launched (or fails for a reason other than absence). */
  hasSystemBrowser: () => Promise<boolean>;
  install: () => Promise<void>;
  confirm: (question: string) => Promise<boolean>;
  log: (message: string) => void;
}

export function installHelp(version: string): string {
  return [
    "Install them with either of:",
    "  screenshots setup",
    `  pnpm dlx playwright@${version} install chromium chromium-headless-shell`,
    `On Linux, Chromium may also need system packages: ${SYSTEM_PACKAGES_URL}`,
  ].join("\n");
}

function defaultDependencies(): BrowserSetupDependencies {
  const playwright = resolvePlaywrightInstall();
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    playwrightVersion: playwright.version,
    detect() {
      const locations = listInstallLocations(playwright);
      return {
        // `executablePath()` is Playwright's own answer for the full browser; the dry-run
        // locations also cover the headless shell, which has no public path accessor.
        missing: !existsSync(chromium.executablePath()) || locations.some((location) => !existsSync(location)),
        ...(locations[0] ? { cacheDir: dirname(locations[0]) } : {}),
      };
    },
    async hasSystemBrowser() {
      for (const channel of systemChannels("auto")) {
        try {
          await (await chromium.launch({ channel })).close();
          return true;
        } catch (error) {
          if (!isMissingChannelError(error)) return true;
        }
      }
      return false;
    },
    install: () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [playwright.cliPath, "install", ...BROWSERS], { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Browser install failed (${signal ?? `exit code ${code}`}).\n${installHelp(playwright.version)}`));
      });
    }),
    async confirm(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^(y(es)?)?$/i.test((await rl.question(question)).trim());
      } finally {
        rl.close();
      }
    },
    log: (message) => console.log(message),
  };
}

function describeDownload(version: string, cacheDir: string | undefined): string {
  return `Chromium and the Chromium headless shell (Playwright ${version}), ${APPROX_DISK_USAGE} on disk,`
    + ` stored in ${cacheDir ?? "Playwright's shared browser cache"}.`;
}

/**
 * Make sure the render browsers exist before a command launches Chromium. `required` commands
 * (export) fail when the browsers are missing and cannot be installed with consent; `optional`
 * commands (dev: only UI export needs Chromium) warn and carry on.
 */
export async function ensureRenderBrowsers(
  mode: "required" | "optional",
  deps: BrowserSetupDependencies = defaultDependencies(),
  browser: BrowserChoice = DEFAULT_BROWSER_CHOICE,
): Promise<void> {
  // An explicit system browser never needs the download; the launch reports it if it is absent.
  if (browser === "chrome" || browser === "msedge") return;
  const status = deps.detect();
  if (!status.missing) return;
  if (browser === "auto" && await deps.hasSystemBrowser()) return;

  const missingMessage = `Playwright's Chromium browsers are not installed. They download once per machine: ${describeDownload(deps.playwrightVersion, status.cacheDir)}`;
  const help = installHelp(deps.playwrightVersion);
  if (deps.interactive) {
    deps.log(missingMessage);
    if (await deps.confirm("Download them now? [Y/n] ")) {
      await deps.install();
      deps.log("Browsers installed.");
      return;
    }
  }
  if (mode === "optional") {
    deps.log(`${deps.interactive ? "Skipped browser download." : missingMessage} Exporting from the editor needs them.\n${help}`);
    return;
  }
  throw new Error(`${deps.interactive ? "Browser download declined." : missingMessage}\n${help}`);
}

/** `screenshots setup`: explicit consent by invocation, idempotent because Playwright skips present builds. */
export async function runSetupCommand(deps: BrowserSetupDependencies = defaultDependencies()): Promise<void> {
  const { cacheDir } = deps.detect();
  deps.log(`Installing ${describeDownload(deps.playwrightVersion, cacheDir)} Builds already present are skipped.`);
  await deps.install();
  deps.log("Browsers are ready.");
}
