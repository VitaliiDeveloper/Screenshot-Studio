// SPDX-License-Identifier: Apache-2.0
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_RENDER_RESPONSE_BYTES,
  type AgentRenderRequest,
  type AgentRenderResponse,
} from "@screenshot-studio/core/agent-render";
import { runCheckCommand } from "@screenshot-studio/cli/check-command";
import { exportBundle, exportScreenToPng } from "@screenshot-studio/cli/export";
import { runExportCommand } from "@screenshot-studio/cli/export-command";
import {
  collectRenderedLayoutIssues,
  createRenderBrowserSession,
  MISSING_CHROMIUM_MESSAGE,
} from "@screenshot-studio/cli/render-driver";
import { publishFileSafely } from "@screenshot-studio/cli/safe-file-publisher";
import { resolveStoreSpecsPath } from "@web/lib/store-specs-path.js";
import { PROJECT_FILE_NAME } from "./agent-run-verdict.server.js";

const PROJECT_FAILURE = "The editor could not read this project. Run `screenshots check` to see what is wrong with it.";
const RENDER_FAILURE = "The editor could not render this. Run `screenshots check` to look for missing files or fonts, then try again.";
const CANCELLED = "The run ended before this render finished.";
const TOO_LARGE = "The result of this render is too large to return.";
const MESSAGE_LIMIT = 2_000;

/** What the editor run provides; `guard` is the managed lifecycle read guard `/api/export` holds. */
export interface RenderHost {
  /** This Next server, which renders like `/api/export` instead of a second host. */
  origin: string;
  guard: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface RenderJobContext extends RenderHost {
  /** The run's real project folder. */
  projectDir: string;
  isCancelled: () => boolean;
  /** Called once the guard is held: from then on the job can publish, so a stop must wait for it. */
  onGuardHeld?: () => void;
  storeSpecsPath?: string;
  exportBundle?: typeof exportBundle;
  exportScreenToPng?: typeof exportScreenToPng;
  createRenderBrowserSession?: typeof createRenderBrowserSession;
  collectRenderedLayoutIssues?: typeof collectRenderedLayoutIssues;
}

/**
 * Only messages the commands raise on purpose reach the agent, because this code reads with the
 * user's rights: a parser error on a file swapped in for the project quotes that file, and an
 * agent can point the project at a key. Every other error class gets the fixed text.
 */
function agentMessage(error: unknown): string {
  return error instanceof Error && error.constructor === Error && !("code" in error)
    ? error.message.slice(0, MESSAGE_LIMIT)
    : PROJECT_FAILURE;
}

/** The render host's error page repeats the project read error, so its text never travels. */
async function withFixedRenderFailure<T>(render: () => Promise<T>): Promise<T> {
  try {
    return await render();
  } catch (error) {
    throw new Error(error instanceof Error && error.message === MISSING_CHROMIUM_MESSAGE ? error.message : RENDER_FAILURE, { cause: error });
  }
}

/**
 * Runs one validated request through the same commands a terminal runs, with the project, output
 * folder, and browser fixed here. It skips the agent-run write fence on purpose: that fence answers
 * 423 for exactly this run.
 */
export async function runRenderJob(request: AgentRenderRequest, context: RenderJobContext): Promise<AgentRenderResponse> {
  const projectFile = join(context.projectDir, PROJECT_FILE_NAME);
  const exportDir = join(context.projectDir, "export");
  const startWebServer = async () => ({ url: context.origin, exited: new Promise<Error>(() => undefined), stop: async () => undefined });

  const assertPublishable = async (root: string) => {
    if (context.isCancelled()) throw new Error(CANCELLED);
    await assertPinnedProjectFile(projectFile);
    if (root !== exportDir) throw new Error(RENDER_FAILURE);
  };

  const run = async (): Promise<AgentRenderResponse> => {
    if (request.command === "check") {
      const { render, json, strict, layout } = request.flags;
      const { output, exitCode } = await runCheckCommand(
        {
          project: projectFile,
          render: String(render),
          ...(json ? { json: "true" } : {}),
          ...(strict ? { strict: "true" } : {}),
          ...(layout ? { layout } : {}),
        },
        context.storeSpecsPath ?? resolveStoreSpecsPath(),
        {
          startWebServer,
          invalidProjectMessage: PROJECT_FAILURE,
          collectRenderedLayoutIssues: (options) => withFixedRenderFailure(
            () => (context.collectRenderedLayoutIssues ?? collectRenderedLayoutIssues)(options),
          ),
        },
      );
      return { ok: true, output, exitCode };
    }
    const lines: string[] = [];
    await runExportCommand(
      // `--browser` beats the editor's SCREENSHOTS_BROWSER, so a single screen renders with the same
      // pinned Chromium as `/api/export`. No `out`: an explicit one follows links, the default never does.
      { ...request.flags, project: projectFile, browser: "chromium" },
      context.storeSpecsPath ?? resolveStoreSpecsPath(),
      {
        log: (line) => lines.push(line),
        startWebServer,
        createRenderBrowserSession: () => (context.createRenderBrowserSession ?? createRenderBrowserSession)(),
        exportScreenToPng: (options) => withFixedRenderFailure(() => (context.exportScreenToPng ?? exportScreenToPng)(options)),
        exportBundle: (options) => withFixedRenderFailure(() => (context.exportBundle ?? exportBundle)({
          ...options,
          shouldStop: context.isCancelled,
          publicationGuard: async (publish) => {
            await assertPublishable(options.outDir);
            return options.publicationGuard(publish);
          },
        })),
        publishFileSafely: async (options) => {
          await assertPublishable(options.root);
          return publishFileSafely(options);
        },
      },
    );
    return { ok: true, output: lines.join("\n"), exitCode: 0 };
  };

  let response: AgentRenderResponse;
  try {
    response = await context.guard(async () => {
      context.onGuardHeld?.();
      if (context.isCancelled()) throw new Error(CANCELLED);
      await assertPinnedProjectFile(projectFile);
      return run();
    });
  } catch (error) {
    return { ok: false, message: agentMessage(error) };
  }
  return JSON.stringify(response).length > MAX_RENDER_RESPONSE_BYTES ? { ok: false, message: TOO_LARGE } : response;
}

/**
 * The project path has to be the real file in the run's folder. Followed through a link, the export
 * would write beside the link's target and a read error would quote it. An agent still racing this
 * check meets the limits docs/safe-file-publication.md states, and the fixed messages above.
 */
async function assertPinnedProjectFile(projectFile: string): Promise<void> {
  const [entry, real] = await Promise.all([lstat(projectFile), realpath(projectFile)]);
  if (!entry.isFile() || entry.nlink !== 1 || real !== projectFile) {
    throw new Error(`${PROJECT_FILE_NAME} must be a regular file in the project folder, not a link.`);
  }
}
