// SPDX-License-Identifier: Apache-2.0
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "@web/lib/json-guards.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { writePrivateJsonDocument } from "@web/lib/private-json-document.server.js";
import type { AgentDefinition } from "./agents.server.js";

/**
 * Consent to run an `at-own-risk` agent. It lives in the app data root next to the project catalog,
 * never in a project document, and it is bound to the policy's `checkedAt`: a re-verified policy
 * (new text, sources, or consequences) asks again. A missing, unreadable, or malformed file means no
 * consent.
 */
export interface AgentConsentStore {
  isGranted(definition: AgentDefinition): Promise<boolean>;
  grant(definition: AgentDefinition): Promise<void>;
  revoke(agentId: string): Promise<void>;
}

interface ConsentRecord {
  policyCheckedAt: string;
  grantedAt: string;
}

const FILE_NAME = "agent-consents.json";

function parseRecords(contents: string): Map<string, ConsentRecord> {
  const document: unknown = JSON.parse(contents);
  const records = new Map<string, ConsentRecord>();
  if (!isRecord(document) || document.version !== 1 || !isRecord(document.consents)) return records;
  for (const [agentId, record] of Object.entries(document.consents)) {
    if (isRecord(record) && typeof record.policyCheckedAt === "string" && typeof record.grantedAt === "string") {
      records.set(agentId, { policyCheckedAt: record.policyCheckedAt, grantedAt: record.grantedAt });
    }
  }
  return records;
}

/**
 * shortcut: writes are serialized in this process only, which is the only writer of the file; add
 * the storage lock the recent-projects store takes if a second process ever writes it.
 */
export function createAgentConsentStore(root: string = resolveManagedProjectStorageConfig().root): AgentConsentStore {
  const path = join(root, FILE_NAME);
  let queue: Promise<unknown> = Promise.resolve();

  const read = () => readFile(path, "utf8").then(parseRecords).catch(() => new Map<string, ConsentRecord>());
  const mutate = (change: (records: Map<string, ConsentRecord>) => void): Promise<void> => {
    const run = queue.then(async () => {
      const records = await read();
      change(records);
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writePrivateJsonDocument({
        root,
        targetPath: path,
        stagePrefix: ".agent-consents",
        label: "Agent consent",
        contents: `${JSON.stringify({ version: 1, consents: Object.fromEntries(records) })}\n`,
        openFile: open,
        rename,
      });
    });
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async isGranted(definition) {
      return (await read()).get(definition.id)?.policyCheckedAt === definition.policy.checkedAt;
    },
    grant: (definition) => mutate((records) => {
      records.set(definition.id, { policyCheckedAt: definition.policy.checkedAt, grantedAt: new Date().toISOString() });
    }),
    revoke: (agentId) => mutate((records) => {
      records.delete(agentId);
    }),
  };
}

const GLOBAL_KEY = Symbol.for("screenshot-studio.agent-consent-stores");

/** One store per data root, shared across Next module evaluations so its write queue is too. */
export function sharedAgentConsentStore(): AgentConsentStore {
  const root = resolveManagedProjectStorageConfig().root;
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: Map<string, AgentConsentStore> | undefined };
  const stores = serverGlobal[GLOBAL_KEY] ??= new Map();
  let store = stores.get(root);
  if (!store) stores.set(root, store = createAgentConsentStore(root));
  return store;
}
