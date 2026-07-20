// SPDX-License-Identifier: Apache-2.0
import { ProjectLauncher } from "../components/project-launcher/ProjectLauncher";
import type { ProjectLibraryState } from "../components/project-launcher/ProjectGallery";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";
import { projectLibraryService } from "../lib/project-library.server";

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
  const initialProjects = await loadInitialProjects();

  return (
    <ProjectLauncher
      projectTemplates={listStarterProjectTemplates()}
      initialProjects={initialProjects}
    />
  );
}
