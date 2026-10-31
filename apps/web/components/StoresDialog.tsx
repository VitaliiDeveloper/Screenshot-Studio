// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { KeyRound, Store, Upload } from "lucide-react";
import { Publishing, type Project } from "@screenshot-studio/core/model";
import { editorStore } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import {
  clearStoreCredentials,
  fetchStoreCredentials,
  saveStoreCredentials,
  type StoreCredentialInput,
  type StoreCredentialStatuses,
} from "@web/lib/clients/store-upload-client";
import { UPLOAD_STORES, type CredentialStoreId, type StoreCredentialStatus } from "@web/lib/store-upload";
import { cx, DialogShell, editorUi, StatusMessage } from "./editor-ui";

export function storeIdentifier(project: Project, store: CredentialStoreId): string {
  return (store === "google" ? project.publishing?.google?.packageName : project.publishing?.apple?.appId) ?? "";
}

/** The schema's own message for an identifier; an empty value clears it and is always valid. */
export function storeIdentifierError(store: CredentialStoreId, value: string): string | null {
  if (value === "") return null;
  const checked = Publishing.safeParse(store === "google" ? { google: { packageName: value } } : { apple: { appId: value } });
  return checked.success ? null : checked.error.issues[0]?.message ?? "Invalid identifier";
}

export function CredentialStatusLine({ status }: { status: StoreCredentialStatus | undefined }) {
  const text = status === undefined
    ? "Checking key…"
    : status.configured
      ? `Key configured${status.updatedAt ? ` · updated ${new Date(status.updatedAt).toLocaleString()}` : ""}`
      : "No key configured";
  return <p className="text-xs text-[color:var(--editor-color-text-secondary)]">{text}</p>;
}

function KeyFilePicker({ label, accept, file, disabled, onChange }: {
  label: string;
  accept: string;
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="block">
      <input aria-label={label} type="file" accept={accept} disabled={disabled} onChange={(event) => onChange(event.target.files?.[0] ?? null)} className="sr-only" />
      <span className={cx(editorUi.buttonSecondary, "w-full justify-start overflow-hidden")}>
        <Upload size={14} strokeWidth={1.8} />
        <span className="truncate">{file?.name ?? `Choose ${accept} key file`}</span>
      </span>
    </label>
  );
}

/**
 * Store identifiers (saved in the project's `publishing` block) and upload keys (saved in the editor's
 * data folder, never in the project). Stored key values are never read back; only their status shows.
 */
export function StoresDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const [drafts, setDrafts] = useState<Record<CredentialStoreId, string>>(() => ({
    google: project ? storeIdentifier(project, "google") : "",
    apple: project ? storeIdentifier(project, "apple") : "",
  }));
  const [statuses, setStatuses] = useState<StoreCredentialStatuses | null>(null);
  const [googleFile, setGoogleFile] = useState<File | null>(null);
  const [appleFile, setAppleFile] = useState<File | null>(null);
  const [appleIds, setAppleIds] = useState({ keyId: "", issuerId: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchStoreCredentials().then(
      (next) => { if (!cancelled) setStatuses(next); },
      (caught: Error) => { if (!cancelled) setError(caught.message); },
    );
    return () => { cancelled = true; };
  }, []);

  if (!project) return null;

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };
  const saveIdentifier = (store: CredentialStoreId) => {
    const value = drafts[store].trim();
    mutateAndSave(() => editorStore.getState().setPublishing(store === "google"
      ? { google: value ? { packageName: value } : null }
      : { apple: value ? { appId: value } : null }));
  };
  const saveKey = (store: CredentialStoreId) => run(async () => {
    const input: StoreCredentialInput = store === "google"
      ? { store, serviceAccount: await googleFile!.text() }
      : { store, ...appleIds, privateKey: await appleFile!.text() };
    setStatuses(await saveStoreCredentials(input));
    if (store === "google") setGoogleFile(null);
    else setAppleFile(null);
  });
  const clearKey = (store: CredentialStoreId) => run(async () => {
    setStatuses(await clearStoreCredentials(store));
  });

  return (
    <DialogShell
      title="Stores"
      description="Store identifiers are saved in the project. Upload keys stay in the editor's data folder on this computer and are never saved in the project."
      onClose={onClose}
      closeDisabled={pending}
      widthClass="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        {UPLOAD_STORES.map(({ id, label, identifierLabel, uploads }) => {
          const saved = storeIdentifier(project, id);
          const identifierError = storeIdentifierError(id, drafts[id].trim());
          const status = statuses?.[id];
          const keyReady = id === "google" ? googleFile !== null : appleFile !== null && appleIds.keyId !== "" && appleIds.issuerId !== "";
          return (
            <section key={id} aria-labelledby={`store-${id}-title`} className={editorUi.insetPanel}>
              <div className="flex items-center gap-2">
                <Store aria-hidden="true" className="size-4 text-[color:var(--editor-color-text-secondary)]" />
                <h3 id={`store-${id}-title`} className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{label}</h3>
              </div>
              {uploads ? null : (
                <p className="text-xs text-[color:var(--editor-color-text-secondary)]">Uploading to {label} from the editor is not available yet; the identifier and key are kept for it.</p>
              )}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    aria-label={`${label} ${identifierLabel.toLowerCase()}`}
                    aria-invalid={identifierError ? true : undefined}
                    placeholder={id === "google" ? "com.example.app" : "1234567890"}
                    value={drafts[id]}
                    onChange={(event) => setDrafts({ ...drafts, [id]: event.target.value })}
                    className={cx(editorUi.field, editorUi.fieldInvalid)}
                  />
                  {identifierError ? <p className="mt-1 text-xs text-[color:var(--editor-color-danger-text)]">{identifierError}</p> : null}
                </div>
                <button
                  type="button"
                  className={editorUi.buttonSecondary}
                  disabled={identifierError !== null || drafts[id].trim() === saved}
                  onClick={() => saveIdentifier(id)}
                >
                  Save {identifierLabel.toLowerCase()}
                </button>
              </div>

              <div className={editorUi.formPanel}>
                <div className="flex items-center gap-2">
                  <KeyRound size={15} className="text-[color:var(--editor-color-text-secondary)]" strokeWidth={1.8} />
                  <h4 className={editorUi.sectionLabel}>Upload key</h4>
                </div>
                <CredentialStatusLine status={status} />
                {id === "google" ? (
                  <KeyFilePicker label="Google Play service account key" accept=".json" file={googleFile} disabled={pending} onChange={setGoogleFile} />
                ) : (
                  <>
                    <input aria-label="App Store Connect key id" placeholder="Key ID" value={appleIds.keyId} onChange={(event) => setAppleIds({ ...appleIds, keyId: event.target.value.trim() })} className={editorUi.field} />
                    <input aria-label="App Store Connect issuer id" placeholder="Issuer ID" value={appleIds.issuerId} onChange={(event) => setAppleIds({ ...appleIds, issuerId: event.target.value.trim() })} className={editorUi.field} />
                    <KeyFilePicker label="App Store Connect .p8 key" accept=".p8" file={appleFile} disabled={pending} onChange={setAppleFile} />
                  </>
                )}
                <div className="flex justify-end gap-2">
                  {status?.configured ? (
                    <button type="button" className={editorUi.buttonDanger} disabled={pending} onClick={() => void clearKey(id)}>Remove key</button>
                  ) : null}
                  <button type="button" className={editorUi.buttonPrimary} disabled={pending || !keyReady} onClick={() => void saveKey(id)}>
                    {status?.configured ? "Replace key" : "Save key"}
                  </button>
                </div>
              </div>
            </section>
          );
        })}
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        <div className="flex justify-end border-t border-[var(--editor-color-border-subtle)] pt-4">
          <button className={editorUi.buttonSecondary} onClick={onClose} disabled={pending}>Close</button>
        </div>
      </div>
    </DialogShell>
  );
}
