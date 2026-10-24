// SPDX-License-Identifier: Apache-2.0
"use client";

import React from "react";
import { agentOptions } from "@web/components/agent-panel-model";
import { MenuSelect } from "@web/components/editor-ui/MenuSelect";
import { cx } from "@web/components/editor-ui/styles";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";

/** The agent, model and effort pickers, shared by the Agent panel and New project. */
export function AgentPicker({
  agents,
  agent,
  model,
  effort,
  onAgentChange,
  onModelChange,
  onEffortChange,
  layout = "inline",
}: {
  agents: readonly AgentStatus[];
  agent: AgentStatus;
  model: string | null;
  effort: string | null;
  onAgentChange(agentId: string): void;
  onModelChange(model: string): void;
  onEffortChange(effort: string): void;
  /** `stacked` gives the agent its own row, for narrow panels. */
  layout?: "inline" | "stacked";
}) {
  return (
    <div className={cx("flex min-w-0 gap-2", layout === "stacked" ? "flex-col" : "items-center")}>
      <MenuSelect
        ariaLabel="Agent"
        value={agent.id}
        options={agentOptions(agents)}
        onChange={onAgentChange}
        wrapLabels
        // Panels clip overflow, so the menu opens from the trigger's start edge at a fixed width.
        menuClassName="!left-0 !right-auto w-[260px]"
        className="min-w-0"
        triggerClassName="font-medium"
      />
      <div className="flex min-w-0 items-center gap-2">
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
    </div>
  );
}
