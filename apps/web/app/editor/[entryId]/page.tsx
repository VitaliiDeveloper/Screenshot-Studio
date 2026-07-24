// SPDX-License-Identifier: Apache-2.0
import { EditorRouteBootstrap } from "@web/app/editor/editor-route-bootstrap";

export default async function ProjectEditorPage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const { entryId } = await params;
  return <EditorRouteBootstrap key={entryId} entryId={entryId} />;
}
