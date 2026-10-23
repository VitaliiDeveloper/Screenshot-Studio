// SPDX-License-Identifier: Apache-2.0
"use client";

/** The first request for a project created with the agent starting point; its Workspace starts the run. */
export interface AgentStartRequest {
  agentId: string;
  model: string | null;
  message: string;
}

/** The first message, with the chosen destination, exactly as the chat shows it. */
export function agentStartMessage({ description, destination }: { description: string; destination: string }): string {
  return [
    "Create the first screens for this new screenshot project.",
    `Destination: ${destination}`,
    "",
    description.trim(),
  ].join("\n");
}

// Memory only: the prompt stays out of the URL and storage, and a reload cannot start a second run.
let queued: { projectId: string; request: AgentStartRequest } | null = null;

export function queueAgentStart(projectId: string, request: AgentStartRequest): void {
  queued = { projectId, request };
}

export function takeAgentStart(projectId: string): AgentStartRequest | null {
  if (queued?.projectId !== projectId) return null;
  const { request } = queued;
  queued = null;
  return request;
}
