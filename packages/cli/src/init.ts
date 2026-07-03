import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { SCHEMA_VERSION, type Project } from "@screenshot-studio/core/model";

/**
 * `screenshots init` — scaffold the project file and the standard directories (AGENTS.md
 * layout). Phase 0 seeds a minimal but valid project so `export` works immediately after init.
 */

const STANDARD_DIRS = [
  "screenshots/apple/iphone/en",
  "assets/fonts",
  "assets/icons",
  "themes",
  "templates",
  "export",
];

function starterProject(name: string): Project {
  return {
    meta: { name, schemaVersion: SCHEMA_VERSION },
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#0B1020" },
        elements: [
          {
            id: "headline",
            type: "text",
            x: 60,
            y: 360,
            width: 540,
            height: 200,
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
            content: "Your headline",
            fontFamily: "sans-serif",
            size: 96,
            weight: 700,
            lineHeight: 1.15,
            letterSpacing: 0,
            align: "center",
            color: "#FFFFFF",
          },
        ],
      },
    ],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(cwd: string, projectName = "My App Screenshots"): Promise<void> {
  await Promise.all(STANDARD_DIRS.map((d) => mkdir(join(cwd, d), { recursive: true })));

  const projectFile = join(cwd, "app-store-screenshots.json");
  if (await exists(projectFile)) {
    throw new Error(`Refusing to overwrite existing ${projectFile}`);
  }
  await writeFile(projectFile, `${JSON.stringify(starterProject(projectName), null, 2)}\n`, "utf8");
}
