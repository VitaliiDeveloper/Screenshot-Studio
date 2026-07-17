// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { getLayout } from "@screenshot-studio/core/model";
import {
  ProjectPathError,
  readIdentifiedProjectSnapshot,
  resolveExistingProjectPath,
} from "@screenshot-studio/core/storage";
import { RenderStage } from "./RenderStage";

/**
 * Headless render host (docs/editor.md §5, spec §5). One dev-only route, no editor chrome.
 * This route's RenderStage is the static host used by CLI export and the parity harness. The
 * interactive editor uses EditorStage; both consume the shared core background/element node-config
 * contract so render/export parity remains centralized (docs/architecture.md §2).
 *
 * The project is read from disk by path (`?project=`) and validated with the same `core` loader
 * the CLI uses. Arbitrary local file read is acceptable here: the product is a local, self-hosted
 * tool and this route is dev-only.
 */
export const dynamic = "force-dynamic";

export default async function RenderPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; layout?: string; screen?: string; revision?: string }>;
}) {
  const { project: projectPath, layout: requestedLayoutId, screen: screenId, revision } = await searchParams;
  if (!projectPath) {
    return <main data-render-error="missing-project">Missing ?project= path</main>;
  }

  let canonicalProjectPath: string;
  try {
    canonicalProjectPath = await resolveExistingProjectPath(resolve(projectPath));
  } catch (err) {
    return <main data-render-error="read-failed">Cannot read project: {(err as Error).message}</main>;
  }

  let snapshot;
  try {
    snapshot = await readIdentifiedProjectSnapshot(canonicalProjectPath);
  } catch (err) {
    const kind = err instanceof ProjectPathError ? "read-failed" : "invalid-project";
    return <main data-render-error={kind}>{(err as Error).message}</main>;
  }

  if (revision !== undefined && snapshot.revision !== revision) {
    return (
      <main data-render-error="revision-mismatch">
        Project revision changed before render
      </main>
    );
  }

  const project = snapshot.project;
  const layoutId = requestedLayoutId ?? project.preferredExportLayoutId;
  let layout;
  try {
    layout = getLayout(project, layoutId);
  } catch (error) {
    return <main data-render-error="invalid-layout">{(error as Error).message}</main>;
  }
  const targetScreen = screenId ?? layout.screens[0]!.id;
  return (
    <RenderStage
      project={project}
      layoutId={layout.id}
      screenId={targetScreen}
      projectPath={canonicalProjectPath}
    />
  );
}
