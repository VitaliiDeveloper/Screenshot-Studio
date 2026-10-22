// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FontValidationError } from "./font-validation.js";
import {
  createSystemFontScanner,
  SYSTEM_FONT_MAX_BYTES,
  SystemFontNotFoundError,
  SystemFontUnavailableError,
  systemFontRoots,
  type SystemFontCoverage,
  type SystemFontMetadata,
} from "./system-fonts.js";

const fixtures = new URL("../../../", import.meta.url);
const pacifico = new URL("fixtures/sample/assets/fonts/Pacifico-Regular.ttf", fixtures);
const notoArabic = new URL("fixtures/regressions/rtl-parity/assets/fonts/noto-sans-arabic-700.ttf", fixtures);
const studioSans = new URL("apps/web/public/fonts/screenshot-studio-sans-regular-v1.ttf", fixtures);

const latinOnly: SystemFontCoverage = { latin: true, latinExtA: false, cyrillic: false, greek: false };

function face(overrides: Partial<SystemFontMetadata> = {}): SystemFontMetadata {
  return {
    family: "Fake Sans",
    weight: 400,
    italic: false,
    variable: false,
    collection: false,
    fsType: 0,
    coverage: latinOnly,
    ...overrides,
  };
}

let dir: string;
let user: string;
let system: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "system-fonts-"));
  user = join(dir, "user");
  system = join(dir, "system");
  await mkdir(user, { recursive: true });
  await mkdir(system, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function stub(root: string, name: string, bytes = "x"): Promise<void> {
  await mkdir(join(root, name, ".."), { recursive: true });
  await writeFile(join(root, name), bytes);
}

function scannerFor(byFile: Record<string, SystemFontMetadata[] | Error>) {
  const readMetadata = vi.fn((_bytes: Buffer, fileName: string) => {
    const result = byFile[fileName];
    if (result === undefined) throw new Error(`unexpected file ${fileName}`);
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    readMetadata,
    scanner: createSystemFontScanner({
      roots: [{ dir: user, source: "user" }, { dir: system, source: "system" }],
      readMetadata,
    }),
  };
}

describe("system font scanner with real fixtures", () => {
  it("reads family, weight, coverage, format and source recursively", async () => {
    await copyFile(pacifico, join(user, "Pacifico-Regular.ttf"));
    await mkdir(join(system, "nested", "deeper"), { recursive: true });
    await copyFile(notoArabic, join(system, "nested", "deeper", "noto-sans-arabic-700.ttf"));
    await copyFile(studioSans, join(system, "studio-sans.ttf"));
    await stub(system, "README.txt");

    const scanner = createSystemFontScanner({
      roots: [{ dir: user, source: "user" }, { dir: system, source: "system" }],
    });
    const faces = await scanner.list();

    expect(faces.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        family: "Noto Sans", weight: 400, source: "system", format: "ttf",
        coverage: { latin: true, latinExtA: false, cyrillic: false, greek: false },
      },
      {
        family: "Noto Sans Arabic", weight: 700, source: "system", format: "ttf",
        coverage: { latin: true, latinExtA: true, cyrillic: false, greek: false },
      },
      {
        family: "Pacifico", weight: 400, source: "user", format: "ttf",
        coverage: { latin: true, latinExtA: true, cyrillic: true, greek: false },
      },
    ]);
    expect(JSON.stringify(faces)).not.toContain(dir);
  });

  it("reads exactly the scanned bytes through the id", async () => {
    await copyFile(pacifico, join(user, "Pacifico-Regular.ttf"));
    const scanner = createSystemFontScanner({ roots: [{ dir: user, source: "user" }] });
    const [listed] = await scanner.list();

    const file = await scanner.read(listed!.id);

    expect(file.fileName).toBe("Pacifico-Regular.ttf");
    expect(file.bytes).toEqual(await readFile(pacifico));
  });
});

describe("system font scanner policy", () => {
  it("skips italic faces, keeps upright ones, and ignores non-font files", async () => {
    await stub(user, "Fake-Italic.ttf");
    await stub(user, "Fake-Regular.otf");
    await stub(user, "notes.txt");
    await stub(user, "bitmap.pcf.gz");
    const { scanner, readMetadata } = scannerFor({
      "Fake-Italic.ttf": [face({ italic: true })],
      "Fake-Regular.otf": [face({ family: "Fake Upright" })],
    });

    const faces = await scanner.list();

    expect(faces.map(({ family, format }) => [family, format])).toEqual([["Fake Upright", "otf"]]);
    expect(readMetadata).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["restricted license embedding", 0x0002, true],
    ["restricted plus no-subsetting", 0x0102, true],
    ["preview and print", 0x0004, false],
    ["editable", 0x0008, false],
    ["restricted with a less restrictive bit", 0x000a, false],
    ["installable", 0x0000, false],
  ])("fsType: %s", async (_name, fsType, disabled) => {
    await stub(user, "Fake.ttf");
    const { scanner } = scannerFor({ "Fake.ttf": [face({ fsType })] });

    const [listed] = await scanner.list();

    expect(listed!.unavailable !== undefined).toBe(disabled);
    if (disabled) expect(listed!.unavailable).toMatch(/Restricted License embedding/);
  });

  it("lists collections and variable fonts as disabled with a reason", async () => {
    await stub(user, "Collection.ttc");
    await stub(user, "Variable.ttf");
    const { scanner } = scannerFor({
      "Collection.ttc": [
        face({ family: "Helvetica Neue", collection: true }),
        face({ family: "Helvetica Neue", weight: 700, collection: true }),
      ],
      "Variable.ttf": [face({ family: "Inter Var", variable: true })],
    });

    const faces = await scanner.list();

    expect(faces.map(({ family, weight, format, unavailable }) => [family, weight, format, unavailable])).toEqual([
      ["Helvetica Neue", 400, "ttc", expect.stringMatching(/collections/i)],
      ["Helvetica Neue", 700, "ttc", expect.stringMatching(/collections/i)],
      ["Inter Var", 400, "ttf", expect.stringMatching(/variable/i)],
    ]);
  });

  it("disables weights that the project schema cannot store instead of rounding them", async () => {
    await stub(user, "Semilight.ttf");
    await stub(user, "Regular.ttf");
    const { scanner } = scannerFor({
      "Semilight.ttf": [face({ family: "Segoe", weight: 350 })],
      "Regular.ttf": [face({ family: "Segoe", weight: 400 })],
    });

    const faces = await scanner.list();

    expect(faces.map(({ weight, unavailable }) => [weight, unavailable])).toEqual([
      [350, expect.stringMatching(/Weight 350/)],
      [400, undefined],
    ]);
  });

  it("disables oversize files without parsing them and unreadable files with the parser message", async () => {
    await stub(user, "Broken.ttf");
    await stub(user, "Huge.otf");
    await truncate(join(user, "Huge.otf"), SYSTEM_FONT_MAX_BYTES + 1);
    const { scanner, readMetadata } = scannerFor({
      "Broken.ttf": new FontValidationError("Broken.ttf", "the bytes are not a supported font container"),
    });

    const faces = await scanner.list();

    expect(faces.map(({ family, weight, unavailable }) => [family, weight, unavailable])).toEqual([
      ["Broken", null, expect.stringContaining("not a supported font container")],
      ["Huge", null, expect.stringMatching(/Larger than 20 MB/)],
    ]);
    expect(readMetadata).toHaveBeenCalledTimes(1);
    await expect(scanner.read(faces[1]!.id)).rejects.toBeInstanceOf(SystemFontUnavailableError);
  });

  it("keeps one face per family and weight: usable beats disabled, then user beats system", async () => {
    await stub(user, "Mine.ttf");
    await stub(system, "Theirs.ttf");
    await stub(system, "Restricted.ttf");
    await stub(user, "Locked.ttf");
    const { scanner } = scannerFor({
      "Mine.ttf": [face({ family: "Same" })],
      "Theirs.ttf": [face({ family: "Same" })],
      "Locked.ttf": [face({ family: "Other", fsType: 0x0002 })],
      "Restricted.ttf": [face({ family: "Other" })],
    });

    const faces = await scanner.list();

    expect(faces.map(({ family, source, unavailable }) => [family, source, unavailable])).toEqual([
      ["Other", "system", undefined],
      ["Same", "user", undefined],
    ]);
  });

  it("scans lazily once and shares the in-flight scan", async () => {
    await stub(user, "A.ttf");
    const { scanner, readMetadata } = scannerFor({ "A.ttf": [face()] });
    expect(readMetadata).not.toHaveBeenCalled();

    await Promise.all([scanner.list(), scanner.list()]);
    await scanner.list();

    expect(readMetadata).toHaveBeenCalledTimes(1);
  });

  it("skips roots that do not exist", async () => {
    const scanner = createSystemFontScanner({
      roots: [{ dir: join(dir, "missing"), source: "system" }],
      readMetadata: () => { throw new Error("not reached"); },
    });

    await expect(scanner.list()).resolves.toEqual([]);
  });
});

describe("system font scanner containment", () => {
  it("never lists symlinks that leave the root and does not follow symlinked directories", async () => {
    const outside = join(dir, "outside");
    await stub(outside, "Secret.ttf");
    await stub(outside, "Linked/Inner.ttf");
    await stub(user, "Inside.ttf");
    await symlink(join(outside, "Secret.ttf"), join(user, "Escape.ttf"));
    await symlink(join(outside, "Linked"), join(user, "LinkedDir"));
    await symlink(join(user, "Inside.ttf"), join(user, "Alias.ttf"));
    const { scanner, readMetadata } = scannerFor({
      "Inside.ttf": [face({ family: "Inside" })],
      "Alias.ttf": [face({ family: "Inside" })],
    });

    const faces = await scanner.list();

    expect(faces.map(({ family }) => family)).toEqual(["Inside"]);
    expect(readMetadata.mock.calls.map(([, name]) => name).sort()).toEqual(["Alias.ttf", "Inside.ttf"]);
  });

  it("rejects a file that was swapped for a symlink after the scan", async () => {
    const outside = join(dir, "outside");
    await stub(outside, "Secret.ttf", "secret");
    await stub(user, "Swap.ttf", "real");
    const { scanner } = scannerFor({ "Swap.ttf": [face()] });
    const [listed] = await scanner.list();

    await rm(join(user, "Swap.ttf"));
    await symlink(join(outside, "Secret.ttf"), join(user, "Swap.ttf"));

    await expect(scanner.read(listed!.id)).rejects.toBeInstanceOf(SystemFontNotFoundError);
  });

  it("answers unknown ids and path-shaped ids with not found", async () => {
    await stub(user, "A.ttf");
    const { scanner } = scannerFor({ "A.ttf": [face()] });

    for (const id of ["sf_" + "0".repeat(32), "../../etc/passwd", join(user, "A.ttf"), ""]) {
      await expect(scanner.read(id)).rejects.toBeInstanceOf(SystemFontNotFoundError);
    }
  });
});

describe("systemFontRoots", () => {
  it("covers the macOS folders", () => {
    expect(systemFontRoots({ platform: "darwin", home: "/Users/ada" })).toEqual([
      { dir: "/System/Library/Fonts", source: "system" },
      { dir: "/Library/Fonts", source: "system" },
      { dir: "/Users/ada/Library/Fonts", source: "user" },
    ]);
  });

  it("covers the Windows folders from the environment", () => {
    expect(systemFontRoots({
      platform: "win32",
      env: { WINDIR: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      home: "C:\\Users\\ada",
    })).toEqual([
      { dir: "C:\\Windows\\Fonts", source: "system" },
      { dir: "C:\\Users\\ada\\AppData\\Local\\Microsoft\\Windows\\Fonts", source: "user" },
    ]);
    expect(systemFontRoots({ platform: "win32", env: {}, home: "C:\\Users\\ada" })).toEqual([]);
  });

  it("covers the Linux folders", () => {
    expect(systemFontRoots({ platform: "linux", home: "/home/ada" })).toEqual([
      { dir: "/usr/share/fonts", source: "system" },
      { dir: "/usr/local/share/fonts", source: "system" },
      { dir: "/home/ada/.local/share/fonts", source: "user" },
      { dir: "/home/ada/.fonts", source: "user" },
    ]);
  });
});
