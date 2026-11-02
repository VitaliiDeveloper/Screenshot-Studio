// SPDX-License-Identifier: Apache-2.0
"use client";

import type { AgentOtherFiles } from "@web/lib/agents/agent-session.server";
import { editorUi } from "@web/components/editor-ui";
import { hint } from "./agent-panel-styles";

const OTHER_FILE_CHANGE = { added: "added", modified: "changed", removed: "removed" } as const;

/** Files the run changed in the project folder outside the project file; nothing restores them. */
export function OtherFilesView({ otherFiles }: { otherFiles: AgentOtherFiles | null }) {
  if (!otherFiles) {
    return <p className={hint}>The project folder could not be compared, so changes to other files are unknown.</p>;
  }
  const more = otherFiles.count - otherFiles.files.length;
  return (
    <div className="flex flex-col gap-1">
      <p className={editorUi.sectionLabel}>Other files · {otherFiles.count}</p>
      <ul aria-label="Other files changed" className="flex flex-col gap-0.5">
        {otherFiles.files.map((file) => (
          <li key={file.path} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" title={file.path}>{file.path}</span>
            <span className={hint}>{OTHER_FILE_CHANGE[file.change]}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className={hint}>and {more} more</p> : null}
      <p className={hint}>Undo run and Stop don&apos;t restore these files.</p>
    </div>
  );
}
