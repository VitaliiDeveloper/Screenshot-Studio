// SPDX-License-Identifier: Apache-2.0
import { ProjectLauncher } from "../components/project-launcher/ProjectLauncher";
import { listStarterProjectTemplates } from "@screenshot-studio/core/scaffold";

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ switch?: string }>;
}) {
  return (
    <ProjectLauncher
      allowSwitch={(await searchParams).switch === "1"}
      projectTemplates={listStarterProjectTemplates()}
    />
  );
}
