// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  compareVersions,
  formatUpdateNotice,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_URL,
  updateCacheFile,
  updateCheckDisabled,
  type UpdateCheckDependencies,
} from "./update-check.js";

const NOW = 1_800_000_000_000;

function registry(body: unknown, init: ResponseInit = {}): typeof fetch {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init)) as unknown as typeof fetch;
}

function deps(overrides: Partial<UpdateCheckDependencies> = {}): UpdateCheckDependencies & {
  writeCache: ReturnType<typeof vi.fn>;
} {
  return {
    env: {},
    interactive: true,
    now: () => NOW,
    fetch: registry({ version: "0.2.0" }),
    readCache: async () => undefined,
    writeCache: vi.fn(async () => undefined),
    ...overrides,
  } as UpdateCheckDependencies & { writeCache: ReturnType<typeof vi.fn> };
}

describe("compareVersions", () => {
  it.each([
    ["0.1.0", "0.2.0", -1],
    ["0.10.0", "0.9.0", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0+build", "1.0.0", 0],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta", -1],
    ["1.0.0-beta.2", "1.0.0-beta.11", -1],
    ["1.0.0-rc.1", "1.0.0-beta.11", 1],
    ["1.0.0-1", "1.0.0-alpha", -1],
  ] as const)("%s vs %s", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
    expect(compareVersions(b, a)).toBe(expected === 0 ? 0 : -expected);
  });

  it("rejects non-versions", () => {
    expect(compareVersions("latest", "1.0.0")).toBeUndefined();
    expect(compareVersions("1.0", "1.0.0")).toBeUndefined();
  });
});

describe("opt-outs", () => {
  it.each([
    [{ CI: "true" }, true],
    [{ CI: "1" }, true],
    [{ NO_UPDATE_NOTIFIER: "1" }, true],
    [{ SCREENSHOTS_NO_UPDATE_CHECK: "1" }, true],
    [{ SCREENSHOTS_NO_UPDATE_CHECK: "0" }, false],
    [{ CI: "false" }, false],
    [{}, false],
  ] as const)("env %j disabled=%s on a TTY", (env, disabled) => {
    expect(updateCheckDisabled(env, true)).toBe(disabled);
  });

  it("is disabled without a TTY", () => {
    expect(updateCheckDisabled({}, false)).toBe(true);
  });

  it.each([
    ["non-TTY", { interactive: false }],
    ["CI", { env: { CI: "true" } }],
    ["NO_UPDATE_NOTIFIER", { env: { NO_UPDATE_NOTIFIER: "1" } }],
    ["SCREENSHOTS_NO_UPDATE_CHECK", { env: { SCREENSHOTS_NO_UPDATE_CHECK: "1" } }],
  ] as const)("makes no request and writes no cache for %s", async (_name, override) => {
    const d = deps(override);
    await expect(checkForUpdate("0.1.0", d)).resolves.toBeUndefined();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.writeCache).not.toHaveBeenCalled();
  });
});

describe("checkForUpdate", () => {
  it("reports a newer version from the registry and caches it", async () => {
    const d = deps();
    await expect(checkForUpdate("0.1.0", d)).resolves.toBe(formatUpdateNotice("0.1.0", "0.2.0"));
    expect(d.fetch).toHaveBeenCalledWith(UPDATE_CHECK_URL, expect.objectContaining({ signal: expect.anything() }));
    expect(d.writeCache).toHaveBeenCalledWith({ checkedAt: NOW, latest: "0.2.0" });
  });

  it("prints current, latest and the upgrade command on one line", () => {
    const notice = formatUpdateNotice("0.1.0", "0.2.0");
    expect(notice).not.toContain("\n");
    expect(notice).toContain("0.1.0 → 0.2.0");
    expect(notice).toContain("npm install --global @screenshot-studio/cli@0.2.0");
  });

  it("stays quiet when current or ahead", async () => {
    await expect(checkForUpdate("0.2.0", deps())).resolves.toBeUndefined();
    await expect(checkForUpdate("0.3.0", deps())).resolves.toBeUndefined();
    await expect(checkForUpdate("0.2.0-rc.1", deps({ fetch: registry({ version: "0.1.0" }) }))).resolves.toBeUndefined();
  });

  it("notifies a prerelease user about the final release", async () => {
    await expect(checkForUpdate("0.2.0-rc.1", deps())).resolves.toContain("0.2.0");
  });

  it("throttles: a check within 24 h uses the cache and does not fetch", async () => {
    const d = deps({ readCache: async () => ({ checkedAt: NOW - UPDATE_CHECK_INTERVAL_MS + 1000, latest: "0.5.0" }) });
    await expect(checkForUpdate("0.1.0", d)).resolves.toContain("0.5.0");
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.writeCache).not.toHaveBeenCalled();
  });

  it("checks again once the cache is 24 h old", async () => {
    const d = deps({ readCache: async () => ({ checkedAt: NOW - UPDATE_CHECK_INTERVAL_MS, latest: "0.1.5" }) });
    await expect(checkForUpdate("0.1.0", d)).resolves.toContain("0.2.0");
    expect(d.fetch).toHaveBeenCalledOnce();
  });

  it("treats a cache timestamp from the future as stale", async () => {
    const d = deps({ readCache: async () => ({ checkedAt: NOW + 1000, latest: "0.1.5" }) });
    await checkForUpdate("0.1.0", d);
    expect(d.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["network error", () => ({ fetch: vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch })],
    ["timeout", () => ({ fetch: vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch })],
    ["404 (unpublished)", () => ({ fetch: registry({ error: "not found" }, { status: 404 }) })],
    ["bad JSON", () => ({ fetch: registry("<html>", { status: 200 }) })],
    ["missing version", () => ({ fetch: registry({ name: "x" }) })],
    ["non-version string", () => ({ fetch: registry({ version: "\u001b[2Jevil" }) })],
  ] as const)("silently ignores %s and still throttles", async (_name, make) => {
    const d = deps(make());
    await expect(checkForUpdate("0.1.0", d)).resolves.toBeUndefined();
    expect(d.writeCache).toHaveBeenCalledWith({ checkedAt: NOW });
  });

  it("keeps the previously known version when a refresh fails", async () => {
    const d = deps({
      readCache: async () => ({ checkedAt: 0, latest: "0.3.0" }),
      fetch: registry("", { status: 503 }),
    });
    await expect(checkForUpdate("0.1.0", d)).resolves.toContain("0.3.0");
    expect(d.writeCache).toHaveBeenCalledWith({ checkedAt: NOW, latest: "0.3.0" });
  });

  it("is unaffected by unreadable or unwritable cache", async () => {
    const d = deps({
      readCache: async () => { throw new Error("EACCES"); },
      writeCache: vi.fn(async () => { throw new Error("EROFS"); }),
    });
    await expect(checkForUpdate("0.1.0", d)).resolves.toContain("0.2.0");
  });
});

describe("updateCacheFile", () => {
  it("uses the platform user cache directory", () => {
    expect(updateCacheFile({}, "darwin", "/Users/a")).toBe("/Users/a/Library/Caches/screenshot-studio/update-check.json");
    expect(updateCacheFile({}, "linux", "/home/a")).toBe("/home/a/.cache/screenshot-studio/update-check.json");
    expect(updateCacheFile({ XDG_CACHE_HOME: "/xdg" }, "linux", "/home/a")).toBe("/xdg/screenshot-studio/update-check.json");
    expect(updateCacheFile({ LOCALAPPDATA: "C:\\L" }, "win32", "C:\\u")).toBe("C:\\L\\screenshot-studio\\update-check.json");
    expect(updateCacheFile({}, "win32", "C:\\u")).toBe("C:\\u\\AppData\\Local\\screenshot-studio\\update-check.json");
  });
});
