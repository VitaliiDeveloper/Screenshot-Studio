// SPDX-License-Identifier: Apache-2.0
"use client";

import React from "react";
import { MenuSelect } from "@web/components/editor-ui/MenuSelect";
import { cx } from "@web/components/editor-ui/styles";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";

/** The selected agent's model and effort pickers, shared by the Agent panel and New project. */
export function AgentModelPicker({ agent, model, effort, onModelChange, onEffortChange, className }: {
  agent: AgentStatus;
  model: string | null;
  effort: string | null;
  onModelChange(model: string): void;
  onEffortChange(effort: string): void;
  className?: string;
}) {
  return (
    <div className={cx("flex min-w-0 items-center gap-2", className)}>
      {model ? (
        <MenuSelect
          ariaLabel="Model"
          value={model}
          options={agent.models.map(({ id, label }) => ({ value: id, label }))}
          onChange={onModelChange}
          className="min-w-0"
          triggerClassName="font-medium"
        />
      ) : <span className="text-xs text-[color:var(--editor-color-text-secondary)]">CLI default model</span>}
      {effort ? (
        <MenuSelect
          ariaLabel="Effort"
          value={effort}
          options={agent.efforts.map(({ id, label }) => ({ value: id, label, triggerLabel: `${label} effort` }))}
          onChange={onEffortChange}
          className="min-w-0"
          triggerClassName="font-medium"
        />
      ) : null}
    </div>
  );
}
