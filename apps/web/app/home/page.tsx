// SPDX-License-Identifier: Apache-2.0
import { ProjectHome } from "@web/components/project-launcher/ProjectHome";

export default async function ProjectHomePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  return <ProjectHome expectedProjectId={(await searchParams).project} />;
}
