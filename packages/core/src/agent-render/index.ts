// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/**
 * The file protocol between a sandboxed `screenshots` CLI and the editor that renders for it. The
 * agent can write every file here, so the editor treats a request as untrusted input.
 * See docs/architecture.md § 6.
 */
export const RENDER_INBOX_ENV = "SCREENSHOT_STUDIO_RENDER_INBOX";

export const MAX_RENDER_REQUEST_BYTES = 4 * 1024;
export const MAX_RENDER_RESPONSE_BYTES = 1024 * 1024;
export const RENDER_HEARTBEAT_MS = 2_000;
/** A request nobody marked as picked up within this time means no editor is listening. */
export const RENDER_PICKUP_TIMEOUT_MS = 10_000;
/** Longer than a few missed heartbeats, so a busy event loop does not look like a dead editor. */
export const RENDER_HEARTBEAT_STALE_MS = 20_000;

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REQUEST_FILE = new RegExp(`^request-(${ID})\\.json$`);

export const renderRequestFile = (id: string) => `request-${id}.json`;
export const renderPickedFile = (id: string) => `picked-${id}`;
export const renderResponseFile = (id: string) => `response-${id}.json`;

/** The request id a file name carries, or null for any name the protocol does not define. */
export function renderRequestId(fileName: string): string | null {
  return REQUEST_FILE.exec(fileName)?.[1] ?? null;
}

const flagValue = z.string().min(1).max(256);

/** The whole of what an agent chooses: the editor fixes the project, output folder, and browser. */
export const AgentRenderRequest = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("export"),
    flags: z.strictObject({
      screen: flagValue.optional(),
      size: flagValue.optional(),
      layout: flagValue.optional(),
      locale: flagValue.optional(),
      platform: flagValue.optional(),
      device: flagValue.optional(),
      profile: flagValue.optional(),
    }),
  }),
  z.strictObject({
    command: z.literal("check"),
    flags: z.strictObject({
      render: z.literal(true),
      json: z.literal(true).optional(),
      strict: z.literal(true).optional(),
      layout: flagValue.optional(),
    }),
  }),
]);
export type AgentRenderRequest = z.infer<typeof AgentRenderRequest>;

export const AgentRenderResponse = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), output: z.string(), exitCode: z.number().int() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type AgentRenderResponse = z.infer<typeof AgentRenderResponse>;
