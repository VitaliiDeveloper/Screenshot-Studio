// SPDX-License-Identifier: Apache-2.0
"use client";

/** The first request for a project created by Start with agent; its Workspace starts the run. */
export interface AgentStartRequest {
  agentId: string;
  model: string | null;
  message: string;
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
