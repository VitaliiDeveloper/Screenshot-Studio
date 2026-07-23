// SPDX-License-Identifier: Apache-2.0
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { createProjectScaffold, projectScaffoldFiles } from "@screenshot-studio/core/scaffold";
import { DEFAULT_PROJECT_FILENAME } from "./project-io.js";

/**
 * `screenshots init` — scaffold the project file, agent instructions, and standard directories.
 * The minimal project is valid immediately, while its project-local guide documents copy,
 * literal-layout, and translation workflows without adding persisted agent state.
 */

const STANDARD_DIRS = [
  "screenshots/apple/iphone/en",
  "assets/fonts",
  "assets/icons",
  "themes",
  "templates",
  "export",
];

const AGENT_GUIDE_FILE = "AGENTS.md";
const CLAUDE_GUIDE_FILE = "CLAUDE.md";
const CONTROL_FILES = [DEFAULT_PROJECT_FILENAME, AGENT_GUIDE_FILE, CLAUDE_GUIDE_FILE];
const CLAUDE_GUIDE = `# CLAUDE.md

Follow the project workflow and schema instructions in \`AGENTS.md\`.

@AGENTS.md
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(
  cwd: string,
  projectName: string | undefined,
  storeSpecs: StoreSpecs,
): Promise<void> {
  for (const filename of CONTROL_FILES) {
    const path = join(cwd, filename);
    if (await exists(path)) {
      throw new Error(`Refusing to overwrite existing ${path}`);
    }
  }

  const agentGuide = await readFile(new URL("./project-agent-guide.md", import.meta.url), "utf8");
  const scaffoldFiles = projectScaffoldFiles(createProjectScaffold({
    name: projectName ?? "My App Screenshots",
    platform: "apple",
    device: "iphone",
    layoutMode: "isolated",
    templateId: null,
  }, storeSpecs));
  await Promise.all(STANDARD_DIRS.map((d) => mkdir(join(cwd, d), { recursive: true })));

  await Promise.all([
    ...scaffoldFiles.map((file) => writeFile(join(cwd, file.path), file.bytes, { flag: "wx" })),
    writeFile(join(cwd, AGENT_GUIDE_FILE), agentGuide, { encoding: "utf8", flag: "wx" }),
    writeFile(join(cwd, CLAUDE_GUIDE_FILE), CLAUDE_GUIDE, { encoding: "utf8", flag: "wx" }),
  ]);
}
