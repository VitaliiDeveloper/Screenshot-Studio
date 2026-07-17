// SPDX-License-Identifier: Apache-2.0
import { ProjectLauncher } from "../components/project-launcher/ProjectLauncher";

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ switch?: string }>;
}) {
  return <ProjectLauncher allowSwitch={(await searchParams).switch === "1"} />;
}
