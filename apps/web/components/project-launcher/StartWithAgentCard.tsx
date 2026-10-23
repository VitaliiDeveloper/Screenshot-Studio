// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useId, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import {
  isDeviceSupportedForPlatform,
  PROJECT_NAME_MAX_LENGTH,
  recommendedDeviceForPlatform,
} from "@screenshot-studio/core/scaffold";
import { listOutputDestinations, listOutputFamilies, type StoreSpecs } from "@screenshot-studio/core/export";
import { MenuSelect } from "@web/components/editor-ui/MenuSelect";
import { cx, editorUi } from "@web/components/editor-ui/styles";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { AgentStartRequest } from "@web/lib/editor/agent-start-request";
import type { ProjectCreationForm } from "./project-creation-model";

const DESCRIPTION_MAX_LENGTH = 10_000;
const fieldLabel = "flex flex-col gap-1 text-xs font-medium text-[color:var(--editor-color-text-muted)]";

/** The first message, with the chosen destination and locales, exactly as the chat shows it. */
export function agentStartMessage({ description, destination, locales }: {
  description: string;
  destination: string;
  locales: string;
}): string {
  return [
    "Create the first screens for this new screenshot project.",
    `Destination: ${destination}`,
    ...(locales.trim() ? [`Locales: ${locales.trim()}`] : []),
    "",
    description.trim(),
  ].join("\n");
}

function destinationOptions(specs: StoreSpecs) {
  const destinations = listOutputDestinations(specs);
  return listOutputFamilies(specs)
    .filter(({ platform, device, creatable }) => creatable && isDeviceSupportedForPlatform(platform, device))
    .map(({ key, platform, label }) => ({
      value: key,
      label: `${destinations.find(({ id }) => id === platform)?.label ?? platform} · ${label}`,
    }));
}

export interface StartWithAgentCardProps {
  /** Agents that can run now; the card is not shown without one. */
  agents: readonly [AgentStatus, ...AgentStatus[]];
  specs: StoreSpecs;
  busy: boolean;
  error: string | null;
  onStart(form: ProjectCreationForm, request: AgentStartRequest): void;
}

export function StartWithAgentCard({ agents, specs, busy, error, onStart }: StartWithAgentCardProps) {
  const headingId = useId();
  const options = destinationOptions(specs);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("My App Screenshots");
  const [destination, setDestination] = useState<string>(() => `apple/${recommendedDeviceForPlatform("apple", specs)}`);
  const [locales, setLocales] = useState("");
  const [agentId, setAgentId] = useState(agents[0].id);
  const [model, setModel] = useState<string | null>(null);
  const agent = agents.find(({ id }) => id === agentId) ?? agents[0];
  const selectedModel = model && agent.models.includes(model) ? model : agent.models[0] ?? null;
  const family = options.find(({ value }) => value === destination) ?? options[0];
  const ready = !busy && family !== undefined && description.trim() !== "" && name.trim() !== "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const [platform, device] = family.value.split("/");
    onStart(
      { name, platform, device, layoutMode: "isolated", templateId: null } as ProjectCreationForm,
      {
        agentId: agent.id,
        model: selectedModel,
        message: agentStartMessage({ description, destination: family.label, locales }),
      },
    );
  };

  return (
    <section aria-labelledby={headingId} className={cx(editorUi.agentBox, "mb-8 max-w-[1080px] px-5 py-4")}>
      <form className="flex flex-col gap-3.5" onSubmit={submit}>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 id={headingId} className="text-sm font-semibold text-[color:var(--editor-color-agent-text)]">Start with agent</h2>
          <p className="text-[11px] text-[color:var(--editor-color-text-secondary)]">Describe the app. The agent creates the first screens in a new project.</p>
        </div>
        <fieldset disabled={busy} className="flex flex-col gap-3.5">
          <textarea
            aria-label="Describe the app"
            required
            rows={2}
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder="Habit tracker for runners. Calm, light look. Five screens, English and German."
            className={cx(editorUi.textarea, "border-[var(--editor-color-agent-border)] text-sm")}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className={fieldLabel}>
              <span>Destination</span>
              <MenuSelect ariaLabel="Destination" value={family?.value ?? destination} options={options} onChange={setDestination} className="w-60" />
            </div>
            <label className={fieldLabel}>
              Locales
              <input type="text" autoComplete="off" placeholder="EN, DE" className={cx(editorUi.field, "w-32")} value={locales} onChange={(event) => setLocales(event.currentTarget.value)} />
            </label>
            <label className={fieldLabel}>
              Project name
              <input type="text" required maxLength={PROJECT_NAME_MAX_LENGTH} autoComplete="off" className={cx(editorUi.field, "w-48")} value={name} onChange={(event) => setName(event.currentTarget.value)} />
            </label>
            <div className={fieldLabel}>
              <span>Agent</span>
              <div className="flex items-center gap-2">
                <MenuSelect ariaLabel="Agent" value={agent.id} options={agents.map(({ id, name: agentName }) => ({ value: id, label: agentName }))} onChange={(id) => { setAgentId(id); setModel(null); }} className="w-40" />
                {selectedModel ? (
                  <MenuSelect ariaLabel="Model" value={selectedModel} options={agent.models.map((value) => ({ value, label: value }))} onChange={setModel} className="w-24" />
                ) : <span className="text-[11px]">CLI default model</span>}
              </div>
            </div>
            <button type="submit" disabled={!ready} className={cx(editorUi.buttonAgent, "ml-auto")}>
              {busy ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> Creating project…</> : `Create with ${agent.name}`}
            </button>
          </div>
        </fieldset>
        {error ? <p role="alert" className={editorUi.statusError}>{error}</p> : null}
        <p className="text-[11px] leading-[1.45] text-[color:var(--editor-color-text-secondary)]">
          Creates a managed project the way New project does, then runs the agent in it under your subscription. The Workspace opens on the run and its review. Ask for more stores or sizes in the description.
        </p>
      </form>
    </section>
  );
}
