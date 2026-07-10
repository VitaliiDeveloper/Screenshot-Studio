import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SCHEMA_VERSION, type Project } from "@screenshot-studio/core/model";

/**
 * `screenshots init` — scaffold the project file, agent instructions, and standard directories.
 * The minimal project is valid immediately, while its project-local guide documents the Phase 5
 * copy, literal-layout, and translation workflows without adding persisted agent state.
 */

const STANDARD_DIRS = [
  "screenshots/apple/iphone/en",
  "assets/fonts",
  "assets/icons",
  "themes",
  "templates",
  "export",
];

const PROJECT_FILE = "app-store-screenshots.json";
const AGENT_GUIDE_FILE = "AGENTS.md";
const CLAUDE_GUIDE_FILE = "CLAUDE.md";
const CONTROL_FILES = [PROJECT_FILE, AGENT_GUIDE_FILE, CLAUDE_GUIDE_FILE];
const CLAUDE_GUIDE = `# CLAUDE.md

Follow the project workflow and schema instructions in \`AGENTS.md\`.

@AGENTS.md
`;

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
        direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#0B1020" },
        // A blank starter is exportable everywhere. Adding a system-font headline here would
        // immediately violate the file-backed font parity contract.
        elements: [],
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
  for (const filename of CONTROL_FILES) {
    const path = join(cwd, filename);
    if (await exists(path)) {
      throw new Error(`Refusing to overwrite existing ${path}`);
    }
  }

  const agentGuide = await readFile(new URL("./project-agent-guide.md", import.meta.url), "utf8");
  await Promise.all(STANDARD_DIRS.map((d) => mkdir(join(cwd, d), { recursive: true })));

  await Promise.all([
    writeFile(
      join(cwd, PROJECT_FILE),
      `${JSON.stringify(starterProject(projectName), null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(join(cwd, AGENT_GUIDE_FILE), agentGuide, { encoding: "utf8", flag: "wx" }),
    writeFile(join(cwd, CLAUDE_GUIDE_FILE), CLAUDE_GUIDE, { encoding: "utf8", flag: "wx" }),
  ]);
}
