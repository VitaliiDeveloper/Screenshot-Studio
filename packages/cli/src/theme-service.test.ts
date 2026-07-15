// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { updateProjectFile } from "./project-io.js";
import { applyThemeFile, listThemes, loadTheme, ThemeValidationError } from "./theme-service.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function controlledLockWait(): {
  options: ProjectLockOptions;
  didWait: Promise<void>;
  release: () => void;
} {
  let markWait!: () => void;
  const didWait = new Promise<void>((resolve) => { markWait = resolve; });
  const waiters: Array<() => void> = [];
  return {
    didWait,
    options: {
      timeoutMs: 500,
      staleAfterMs: 10_000,
      dependencies: {
        sleep: () => {
          markWait();
          return new Promise<void>((resolve) => waiters.push(resolve));
        },
        scheduleHeartbeat: () => () => undefined,
      },
    },
    release: () => { waiters.splice(0).forEach((resolve) => resolve()); },
  };
}

async function fixture() {
  const dir = await temporaryDirectory("theme-service-");
  const projectPath = join(dir, "app-store-screenshots.json");
  const project = {
    meta: { name: "Themes", schemaVersion: 1 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "accent", type: "shape", role: "accent", x: 0, y: 0, width: 100, height: 10, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FFFFFF", radius: 0 }] }],
  };
  const theme = { id: "midnight", name: "Midnight", colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" }, fonts: {} };
  await mkdir(join(dir, "themes"));
  await writeFile(projectPath, JSON.stringify(project));
  await writeFile(join(dir, "themes/midnight.json"), JSON.stringify(theme));
  return { dir, projectPath, theme };
}

describe("theme-service", () => {
  it("lists definitions in stable id order", async () => {
    const { dir, projectPath, theme } = await fixture();
    await writeFile(join(dir, "themes/amber.json"), JSON.stringify({ ...theme, id: "amber", name: "Amber" }));
    expect((await listThemes(projectPath)).map((item) => item.id)).toEqual(["amber", "midnight"]);
  });

  it("rejects mismatched filenames and ids", async () => {
    const { dir, projectPath, theme } = await fixture();
    await writeFile(join(dir, "themes/wrong.json"), JSON.stringify({ ...theme, id: "other" }));
    await expect(listThemes(projectPath)).rejects.toBeInstanceOf(ThemeValidationError);
  });

  it("loads and applies a theme through the shared service", async () => {
    const { projectPath } = await fixture();
    expect((await loadTheme(projectPath, "midnight")).name).toBe("Midnight");
    await applyThemeFile(projectPath, "midnight");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });

  it("resolves list, load, and apply resources beside a symlinked project target", async () => {
    const { projectPath } = await fixture();
    const aliasDir = await temporaryDirectory("theme-service-alias-");
    const aliasPath = join(aliasDir, "project-alias.json");
    await symlink(projectPath, aliasPath);

    expect((await listThemes(aliasPath)).map((theme) => theme.id)).toEqual(["midnight"]);
    await expect(loadTheme(aliasPath, "midnight")).resolves.toMatchObject({ name: "Midnight" });
    await applyThemeFile(aliasPath, "midnight");

    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });

  it("queues apply behind the project lease while list remains lock-free", async () => {
    const { projectPath } = await fixture();
    let releaseHeld!: () => void;
    const heldMayFinish = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let heldEntered!: () => void;
    const heldDidEnter = new Promise<void>((resolve) => { heldEntered = resolve; });

    const held = updateProjectFile(projectPath, async (project) => {
      heldEntered();
      await heldMayFinish;
      return {
        project: { ...project, meta: { ...project.meta, name: "Held writer" } },
        value: undefined,
      };
    });
    const heldOutcome = held.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await heldDidEnter;
    await expect(listThemes(projectPath)).resolves.toHaveLength(1);

    const lockWait = controlledLockWait();
    const apply = applyThemeFile(projectPath, "midnight", lockWait.options);
    const applyOutcome = apply.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const queueState = await Promise.race([
      lockWait.didWait.then(() => "waited" as const),
      applyOutcome.then(() => "settled" as const),
    ]);

    releaseHeld();
    const heldResult = await heldOutcome;
    lockWait.release();
    const applyResult = await applyOutcome;

    expect(queueState).toBe("waited");
    expect(heldResult.status).toBe("fulfilled");
    expect(applyResult.status).toBe("fulfilled");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.meta.name).toBe("Held writer");
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });
});
