// SPDX-License-Identifier: Apache-2.0
import { dirname, join } from "node:path";
import { isRecord } from "@web/lib/json-guards.js";
import type {
  AgentErrorCode,
  AgentEvent,
  AgentOutputNormalizer,
  AgentRunRequest,
  AgentStep,
} from "./agent-session.server.js";

const SUMMARY_LIMIT = 2_000;
const RESETS_LIMIT = 80;

type CliErrorCode = Exclude<AgentErrorCode, "timeout">;

/** How one CLI words its failures; only the fixed `messages` ever reach the client. */
export interface CliFailure {
  usageLimit: RegExp;
  notAuthorized: RegExp;
  /** The first group is the limit reset time as the CLI words it. */
  resets: RegExp;
  messages: Record<CliErrorCode, string>;
  /** Known failures without a typed code; they stay `failed` but keep an accurate message. */
  explained?: readonly { pattern: RegExp; message: string }[];
}

export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function summary(value: string | null): string | null {
  return value?.slice(0, SUMMARY_LIMIT) ?? null;
}

/** A reference file shipped beside the Screenshot Studio skill. */
export function skillReference(skillPath: string, name: string): string {
  return join(dirname(skillPath), "references", name);
}

/** The project instructions every agent gets; `planning` names that CLI's own checklist tool. */
export function projectInstructions({ mode, context, attachments }: AgentRunRequest, planning: string): string {
  const { skillPath } = context;
  const critic = mode === "critic";
  return [
    critic
      ? "You are reviewing the Screenshot Studio project in the current working directory as its critic."
      : "You are editing the Screenshot Studio project in the current working directory.",
    context.agentGuidePath ?? context.bundledGuidePath
      ? `Before changing anything, read ${context.agentGuidePath ?? context.bundledGuidePath} completely and follow it; it is the authoritative workflow and schema contract.`
      : "Read app-store-screenshots.json before changing anything; it is a strict schema.",
    skillPath ? `The Screenshot Studio skill is at ${skillPath}.` : "",
    critic
      ? `This run is read-only. Read ${skillPath ? skillReference(skillPath, "critic.md") : "the critic rules"} completely and follow it. Use only listing commands and \`screenshots export\` with \`--project ./app-store-screenshots.json\`; never change the project or run \`screenshots dev\`. A change to the project is rolled back.`
      : "Change the project only through the `screenshots` CLI with `--project ./app-store-screenshots.json`. Never run `screenshots dev` or `screenshots` without a command.",
    !critic && skillPath
      ? `When the request is about store marketing, copy, a livelier or more premium look, or restyling from a reference image, read ${skillReference(skillPath, "art-direction.md")} first and follow it.`
      : "",
    // Named here because a project's AGENTS.md is copied at init and may predate `asset import`.
    attachments.length > 0
      ? `The user attached these images to this request:\n${attachments.join("\n")}\nThey are reference context. Only when the user asks to use one in the project, run \`screenshots asset import <path> --project ./app-store-screenshots.json\` and assign the printed project-relative path with \`screenshots element media\`. Never copy image files into the project yourself.`
      : "",
    planning,
  ].filter(Boolean).join("\n");
}

/**
 * A failed run's last events. Failure text is only classified, like stderr: it may carry absolute
 * paths or account hints, so the client gets the fixed message for its code.
 */
export function failedRun(failure: CliFailure, output: string, durationMs: number | null): AgentEvent[] {
  const code: CliErrorCode = failure.usageLimit.test(output)
    ? "usage-limit"
    : failure.notAuthorized.test(output) ? "not-authorized" : "failed";
  const resets = code === "usage-limit"
    ? failure.resets.exec(output)?.[1]?.trim().slice(0, RESETS_LIMIT) ?? null
    : null;
  const explained = code === "failed" ? failure.explained?.find(({ pattern }) => pattern.test(output)) : undefined;
  return [
    { type: "error", code, message: explained?.message ?? failure.messages[code], resets },
    { type: "done", status: "failed", summary: null, durationMs },
  ];
}

export function progressEvent(steps: AgentStep[]): AgentEvent[] {
  if (steps.length === 0) return [];
  const current = steps.findIndex((step) => step.status === "in_progress");
  const completed = steps.filter((step) => step.status === "completed").length;
  const step = current >= 0 ? current + 1 : Math.min(completed + 1, steps.length);
  return [{ type: "progress", step, total: steps.length, steps }];
}

/**
 * One JSON object per output line. Malformed lines are skipped, nothing after the first `done`
 * counts, and an exit without one is classified by `unfinishedExit`.
 */
export function jsonLineNormalizer(
  message: (message: Record<string, unknown>) => AgentEvent[],
  unfinishedExit: (stderr: string) => AgentEvent[],
): AgentOutputNormalizer {
  let finished = false;
  return {
    line(line) {
      if (finished) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return [];
      }
      if (!isRecord(parsed)) return [];
      const events = message(parsed);
      finished = events.some(({ type }) => type === "done");
      return events;
    },
    end({ stderr }) {
      return finished ? [] : unfinishedExit(stderr);
    },
  };
}
