import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { RenderStage } from "./RenderStage";

/**
 * Headless render host (docs/editor.md §5, spec §5). One dev-only route, no editor chrome.
 * This is the single served artifact the CLI export AND the parity harness both point at, so
 * UI and CLI share one rendering path (docs/architecture.md §2). The Phase 1 export button must
 * later reuse <RenderStage>, never a parallel react-konva tree.
 *
 * The project is read from disk by path (`?project=`) and validated with the same `core` loader
 * the CLI uses. Arbitrary local file read is acceptable here: the product is a local, self-hosted
 * tool and this route is dev-only.
 */
export const dynamic = "force-dynamic";

export default async function RenderPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; screen?: string }>;
}) {
  const { project: projectPath, screen: screenId } = await searchParams;
  if (!projectPath) {
    return <main data-render-error="missing-project">Missing ?project= path</main>;
  }

  let projectJson: string;
  try {
    projectJson = await readFile(resolve(projectPath), "utf8");
  } catch (err) {
    return <main data-render-error="read-failed">Cannot read project: {(err as Error).message}</main>;
  }

  let project;
  try {
    project = parseProjectJson(projectJson);
  } catch (err) {
    // Surface the validator message; never render an invalid project (editor.md §7).
    return <main data-render-error="invalid-project">{(err as Error).message}</main>;
  }

  const targetScreen = screenId ?? project.screens[0]!.id;
  return <RenderStage project={project} screenId={targetScreen} projectPath={resolve(projectPath)} />;
}
