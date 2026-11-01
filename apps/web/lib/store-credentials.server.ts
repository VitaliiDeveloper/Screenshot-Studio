// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

/** What the Apple upload CLI reads: the ids and the path of the `.p8` key. */
export interface AppleUploadCredentials {
  keyId: string;
  issuerId: string;
  keyPath: string;
}

/**
 * Store keys for uploads, as `0600` files in `<data root>/store-credentials/` (`0700`, with a `*`
 * .gitignore because the default data root sits under the launch directory). Only `status` answers
 * the browser; key paths and ids are for server-side upload execution only. A missing, unreadable, or
 * malformed file means "not configured".
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
  /** Seam for the Apple upload once its CLI lands; its CLI takes the key as a path. */
  appleCredentials(): Promise<AppleUploadCredentials | undefined>;
}

/** Messages are fixed text: a parser message would quote the input, which holds the private key. */
export class StoreCredentialError extends Error {}

const GOOGLE_FILE = "google-play-service-account.json";
const APPLE_IDS_FILE = "app-store-connect.json";
const APPLE_KEY_FILE = "app-store-connect.p8";

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

/** Resolves symlinks in the longest existing prefix, so a not-yet-created folder still compares by its real parent. */
async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realPathOf(parent), basename(path));
  }
}

/** Keys never go inside a project folder, where they could be archived or committed with it. */
export async function assertCredentialsOutsideProject(store: StoreCredentialStore, projectDirectory: string): Promise<void> {
  const path = relative(await realPathOf(resolve(projectDirectory)), await realPathOf(store.directory));
  const outside = path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
  if (!outside) {
    throw new StoreCredentialError(
      "The editor data folder is inside this project, so store keys would be saved with it; start the editor with SCREENSHOT_STUDIO_DATA_ROOT set to a folder outside the project",
    );
  }
}

export function createStoreCredentialStore(root: string = resolveManagedProjectStorageConfig().root): StoreCredentialStore {
  const directory = join(resolve(root), "store-credentials");
  const pathOf = (file: string) => join(directory, file);
  let queue: Promise<unknown> = Promise.resolve();

  const serialized = (operation: () => Promise<void>): Promise<void> => {
    const run = queue.then(operation);
    queue = run.catch(() => undefined);
    return run;
  };
  const write = (files: Array<[file: string, contents: string]>) => serialized(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // A planted symlink would send keys wherever it points, past the inside-project check.
    if ((await lstat(directory)).isSymbolicLink()) {
      throw new StoreCredentialError("The store key folder is a symbolic link; remove it and try again");
    }
    await writeFile(join(directory, ".gitignore"), "*\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    for (const [file, contents] of files) {
      await writePrivateJsonDocument({
        root: directory,
        targetPath: pathOf(file),
        stagePrefix: `.${file}`,
        label: "Store credentials",
        contents,
        openFile: open,
        rename,
      });
    }
  });
  const readValid = async <T>(parse: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await parse();
    } catch {
      return undefined;
    }
  };
  const read = (file: string) => readFile(pathOf(file), "utf8");
  const readApple = () => readValid(async () => {
    const ids: unknown = JSON.parse(await read(APPLE_IDS_FILE));
    const valid = validateAppleCredentials({ ...(isRecord(ids) ? ids : {}), privateKey: await read(APPLE_KEY_FILE) });
    return { keyId: valid.keyId, issuerId: valid.issuerId, keyPath: pathOf(APPLE_KEY_FILE) };
  });
  const googleConfigured = async () => (await readValid(async () => {
    validateGoogleServiceAccount(await read(GOOGLE_FILE));
    return true;
  })) === true;
  const statusOf = async (file: string, configured: boolean): Promise<StoreCredentialStatus> => {
    if (!configured) return { configured: false, updatedAt: null };
    const { mtime } = await stat(pathOf(file));
    return { configured: true, updatedAt: mtime.toISOString() };
  };

  return {
    directory,
    async status() {
      return {
        google: await statusOf(GOOGLE_FILE, await googleConfigured()),
        apple: await statusOf(APPLE_IDS_FILE, (await readApple()) !== undefined),
      };
    },
    async setGoogle(json) {
      validateGoogleServiceAccount(json);
      return write([[GOOGLE_FILE, json]]);
    },
    async setApple(credentials) {
      const { keyId, issuerId, privateKey } = validateAppleCredentials(credentials);
      // The key first: ids without a readable key still read as "not configured".
      return write([[APPLE_KEY_FILE, privateKey], [APPLE_IDS_FILE, `${JSON.stringify({ keyId, issuerId })}\n`]]);
    },
    clear: (store) => serialized(async () => {
      for (const file of store === "google" ? [GOOGLE_FILE] : [APPLE_IDS_FILE, APPLE_KEY_FILE]) {
        await rm(pathOf(file), { force: true });
      }
    }),
    async googleServiceAccountPath() {
      return (await googleConfigured()) ? pathOf(GOOGLE_FILE) : undefined;
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
