// SPDX-License-Identifier: Apache-2.0
import { ProjectLauncher } from "../components/project-launcher/ProjectLauncher";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";

export default function AppHomePage() {
  return (
    <ProjectLauncher
      projectTemplates={listStarterProjectTemplates()}
    />
  );
}
