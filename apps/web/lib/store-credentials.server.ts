// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isRecord } from "@web/lib/json-guards.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { writePrivateJsonDocument } from "@web/lib/private-json-document.server.js";
import type { CredentialStoreId, StoreCredentialStatus } from "./store-upload.js";

export interface AppleStoreCredentials {
  keyId: string;
  issuerId: string;
  /** The `.p8` contents. */
  privateKey: string;
}

/**
 * Store keys for uploads, one `0600` file per store in `<data root>/store-credentials/` (`0700`, with a
 * `*` .gitignore because the default data root sits under the launch directory). Only `status` answers
 * the browser; the file path and the Apple fields are for server-side upload execution only. A missing,
 * unreadable, or malformed file means "not configured".
 */
export interface StoreCredentialStore {
  readonly directory: string;
  status(): Promise<Record<CredentialStoreId, StoreCredentialStatus>>;
  /** `json` is the service-account key file as downloaded from Google Cloud. */
  setGoogle(json: string): Promise<void>;
  setApple(credentials: AppleStoreCredentials): Promise<void>;
  clear(store: CredentialStoreId): Promise<void>;
  /** The key file `screenshots upload --service-account` reads, when one is configured. */
  googleServiceAccountPath(): Promise<string | undefined>;
  /** Seam for the Apple upload once its CLI lands. */
  appleCredentials(): Promise<AppleStoreCredentials | undefined>;
}

/** Messages are fixed text: a parser message would quote the input, which holds the private key. */
export class StoreCredentialError extends Error {}

const FILES: Record<CredentialStoreId, string> = {
  google: "google-play-service-account.json",
  apple: "app-store-connect.json",
};

function isPrivateKey(pem: string): boolean {
  try {
    createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
}

/** Mirrors `readGooglePlayServiceAccount`, so a key the editor accepts is one the CLI can read. */
export function validateGoogleServiceAccount(json: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new StoreCredentialError("The Google Play service account file is not valid JSON");
  }
  if (!isRecord(raw) || typeof raw.client_email !== "string" || typeof raw.private_key !== "string") {
    throw new StoreCredentialError("The Google Play service account file needs client_email and private_key");
  }
  if (!isPrivateKey(raw.private_key)) {
    throw new StoreCredentialError("The Google Play service account private_key is not a valid PEM key");
  }
}

export function validateAppleCredentials(value: unknown): AppleStoreCredentials {
  if (!isRecord(value)) throw new StoreCredentialError("Apple credentials need keyId, issuerId and privateKey");
  const { keyId, issuerId, privateKey } = value;
  if (typeof keyId !== "string" || !/^[A-Z0-9]{10}$/.test(keyId)) {
    throw new StoreCredentialError("Apple key id must be the 10-character App Store Connect API key id");
  }
  if (typeof issuerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuerId)) {
    throw new StoreCredentialError("Apple issuer id must be the App Store Connect issuer UUID");
  }
  if (typeof privateKey !== "string" || !isPrivateKey(privateKey)) {
    throw new StoreCredentialError("The Apple .p8 key is not a valid private key");
  }
  return { keyId, issuerId, privateKey };
}

/** Keys never go inside a project folder, where they could be archived or committed with it. */
export function assertCredentialsOutsideProject(store: StoreCredentialStore, projectDirectory: string): void {
  const path = relative(resolve(projectDirectory), store.directory);
  if (path === "" || (!path.startsWith("..") && !isAbsolute(path))) {
    throw new StoreCredentialError(
      "The editor data folder is inside this project, so store keys would be saved with it; start the editor with SCREENSHOT_STUDIO_DATA_ROOT set to a folder outside the project",
    );
  }
}

export function createStoreCredentialStore(root: string = resolveManagedProjectStorageConfig().root): StoreCredentialStore {
  const directory = join(resolve(root), "store-credentials");
  const pathOf = (store: CredentialStoreId) => join(directory, FILES[store]);
  let queue: Promise<unknown> = Promise.resolve();

  const serialized = (operation: () => Promise<void>): Promise<void> => {
    const run = queue.then(operation);
    queue = run.catch(() => undefined);
    return run;
  };
  const write = (store: CredentialStoreId, contents: string) => serialized(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, ".gitignore"), "*\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await writePrivateJsonDocument({
      root: directory,
      targetPath: pathOf(store),
      stagePrefix: `.${store}-credentials`,
      label: "Store credentials",
      contents,
      openFile: open,
      rename,
    });
  });
  const readValid = async <T>(store: CredentialStoreId, parse: (contents: string) => T): Promise<T | undefined> => {
    try {
      return parse(await readFile(pathOf(store), "utf8"));
    } catch {
      return undefined;
    }
  };
  const readApple = () => readValid("apple", (contents) => validateAppleCredentials(JSON.parse(contents)));
  const googleConfigured = async () => (await readValid("google", (contents) => {
    validateGoogleServiceAccount(contents);
    return true;
  })) === true;
  const statusOf = async (store: CredentialStoreId, configured: boolean): Promise<StoreCredentialStatus> => {
    if (!configured) return { configured: false, updatedAt: null };
    const { mtime } = await stat(pathOf(store));
    return { configured: true, updatedAt: mtime.toISOString() };
  };

  return {
    directory,
    async status() {
      return {
        google: await statusOf("google", await googleConfigured()),
        apple: await statusOf("apple", (await readApple()) !== undefined),
      };
    },
    async setGoogle(json) {
      validateGoogleServiceAccount(json);
      return write("google", json);
    },
    async setApple(credentials) {
      const valid = validateAppleCredentials(credentials);
      return write("apple", `${JSON.stringify(valid)}\n`);
    },
    clear: (store) => serialized(() => rm(pathOf(store), { force: true })),
    async googleServiceAccountPath() {
      return (await googleConfigured()) ? pathOf("google") : undefined;
    },
    appleCredentials: readApple,
  };
}

const GLOBAL_KEY = Symbol.for("screenshot-studio.store-credential-stores");

/** One store per data root, shared across Next module evaluations so its write queue is too. */
export function sharedStoreCredentialStore(): StoreCredentialStore {
  const root = resolveManagedProjectStorageConfig().root;
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: Map<string, StoreCredentialStore> | undefined };
  const stores = serverGlobal[GLOBAL_KEY] ??= new Map();
  let store = stores.get(root);
  if (!store) stores.set(root, store = createStoreCredentialStore(root));
  return store;
}
