// SPDX-License-Identifier: Apache-2.0

const STORAGE_PREFIX = "screenshot-studio:active-layout:v1:";

interface ActiveLayoutPreference {
  version: 1;
  activeLayoutId: string;
}

function browserStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectId)}`;
}

export function readActiveLayoutPreference(
  projectId: string,
  storage?: Storage,
): string | null {
  try {
    const value = browserStorage(storage)?.getItem(storageKey(projectId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ActiveLayoutPreference>;
    return parsed.version === 1
      && typeof parsed.activeLayoutId === "string"
      && parsed.activeLayoutId.length > 0
      ? parsed.activeLayoutId
      : null;
  } catch {
    return null;
  }
}

export function writeActiveLayoutPreference(
  projectId: string,
  activeLayoutId: string,
  storage?: Storage,
): void {
  try {
    browserStorage(storage)?.setItem(storageKey(projectId), JSON.stringify({
      version: 1,
      activeLayoutId,
    } satisfies ActiveLayoutPreference));
  } catch {
    // Browser storage may be unavailable or blocked; the in-memory selection still remains valid.
  }
}
