// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { ProjectLauncher } from "@web/components/project-launcher/ProjectLauncher";
import type { ProjectLibraryState } from "@web/components/project-launcher/ProjectGallery";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { projectLibraryService } from "@web/lib/project-library.server";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path";

async function loadInitialProjects(): Promise<ProjectLibraryState> {
  try {
    return {
      status: "ready",
      entries: (await projectLibraryService.list()).entries,
    };
  } catch {
    return {
      status: "error",
      message: "Projects could not be loaded. Retry, or reopen a local project from its source.",
    };
  }
}

export default async function AppHomePage() {
  const [initialProjects, storeSpecsSource] = await Promise.all([
    loadInitialProjects(),
    readFile(resolveStoreSpecsPath(), "utf8"),
  ]);
  const storeSpecs = parseStoreSpecs(JSON.parse(storeSpecsSource));

  return (
    <ProjectLauncher
      projectTemplates={listStarterProjectTemplates()}
      initialProjects={initialProjects}
      storeSpecs={storeSpecs}
    />
  );
}
