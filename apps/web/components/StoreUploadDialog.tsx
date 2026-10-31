// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { withFlushedProject } from "@web/lib/editor/debounced-save";
import {
  requestUploadPlan,
  startStoreUpload,
  StoreUploadRequestError,
} from "@web/lib/clients/store-upload-client";
import {
  createExportOperationId,
  parseExportProgress,
  type ExportProgressSnapshot,
} from "@web/lib/export-progress";
import {
  appStoreVersionOptions,
  UPLOAD_SLOT_LIMITS,
  UPLOAD_STORES,
  type AppStoreUploadReport,
  type GooglePlayUploadReport,
  type UploadPlanResponse,
  type UploadPlanSkipped,
  type UploadReport,
  type UploadStoreId,
  uploadImageCount,
} from "@web/lib/store-upload";
import { DialogShell, editorUi, MenuSelect, StatusMessage } from "./editor-ui";
import { ExportProgressStatus } from "./ExportProgressStatus";
import { plural } from "./export-dialog-model";

const SLOT_LABELS: Record<string, string> = {
  phoneScreenshots: "Phone screenshots",
  sevenInchScreenshots: "7-inch tablet screenshots",
  tenInchScreenshots: "10-inch tablet screenshots",
  tvScreenshots: "TV screenshots",
  wearScreenshots: "Wear OS screenshots",
  featureGraphic: "Feature graphic",
};

const slotLabel = (imageType: string) => SLOT_LABELS[imageType] ?? imageType;

function skippedSummary(skipped: readonly UploadPlanSkipped[]): string {
  const counts = new Map<string, number>();
  for (const { platform, device } of skipped) counts.set(`${platform}/${device}`, (counts.get(`${platform}/${device}`) ?? 0) + 1);
  return [...counts].map(([family, count]) => `${family} (${count})`).join(", ");
}

/** Same grouping as the CLI's dry run: one line per family, size and reason. */
function skippedReasons(skipped: ReadonlyArray<UploadPlanSkipped & { reason: string }>): string[] {
  const counts = new Map<string, number>();
  for (const { platform, device, sizeId, reason } of skipped) {
    const key = `${platform}/${device} ${sizeId}: ${reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => `${key} (${count})`);
}

const NON_ATOMIC = "App Store Connect has no atomic commit: sets are replaced one at a time, so sets before the stop stay replaced, a partial set may be missing screenshots, and untouched sets were not changed; fix the cause and upload again.";

const UPLOADABLE = UPLOAD_STORES.filter((entry): entry is Extract<(typeof UPLOAD_STORES)[number], { id: UploadStoreId }> => entry.uploads);

/** What the confirmed upload will do, from the store's plan. */
export function UploadPlanReview({ plan, onVersion }: { plan: UploadPlanResponse; onVersion: (version: string) => void }) {
  return plan.store === "google" ? <GooglePlayPlanReview plan={plan} /> : <AppStorePlanReview plan={plan} onVersion={onVersion} />;
}

/** Per App Store version, localization and display type; the versions are read from App Store Connect. */
function AppStorePlanReview({ plan, onVersion }: {
  plan: Extract<UploadPlanResponse, { store: "apple" }>;
  onVersion: (version: string) => void;
}) {
  const { locales, skipped } = plan.plan;
  const options = plan.versions ? appStoreVersionOptions(plan.versions) : [];
  return (
    <div className="flex flex-col gap-3 text-xs text-[color:var(--editor-color-text-default)]">
      <p>
        App <span className="font-mono">{plan.identifier}</span> · layout <span className="font-mono">{plan.layoutId}</span>
      </p>
      {plan.versions === null ? (
        <p className="text-[color:var(--editor-color-text-secondary)]">The App Store versions are read from App Store Connect once its API key is in Stores.</p>
      ) : (
        <ul aria-label="App Store versions" className="flex flex-col gap-1">
          {plan.versions.map(({ platform, editable, selected }) => (
            <li key={platform}>
              <span className="font-medium">{platform}</span>:{" "}
              {editable.length === 0
                ? "no editable version"
                : selected !== null
                  ? `version ${selected} (${editable.find(({ versionString }) => versionString === selected)!.state})`
                  : `several editable versions: ${editable.map(({ versionString, state }) => `${versionString} (${state})`).join(", ")}`}
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 ? (
        <MenuSelect
          ariaLabel="App Store version"
          value={plan.version ?? ""}
          options={[...plan.version === null ? [{ value: "", label: "Choose the version to upload to" }] : [], ...options.map((value) => ({ value, label: value }))]}
          onChange={(value) => { if (value) onVersion(value); }}
          className="max-w-56"
        />
      ) : null}
      {plan.blocked ? <StatusMessage tone="warning">{plan.blocked}</StatusMessage> : null}
      <ul aria-label="Upload plan" className="flex flex-col gap-2">
        {locales.map((locale) => (
          <li key={`${locale.platform}/${locale.locale}`} className={editorUi.formPanel}>
            <h4 className="font-semibold text-[color:var(--editor-color-text-strong)]">
              {locale.platform} {locale.locale} <span className="font-normal text-[color:var(--editor-color-text-secondary)]">from project locale {locale.projectLocale}</span>
            </h4>
            <ul className="flex flex-col gap-1">
              {locale.sets.map((set) => (
                <li key={set.displayType}>
                  <span className="font-medium">{set.displayType}</span>: uploads {plural(set.upload.length, "screenshot")} at {[...new Set(set.upload.map(({ sizeId }) => sizeId))].join(", ")} ({set.upload.map(({ screenName }) => screenName).join(", ")}),{" "}
                  {set.replace === null ? "replacing every current screenshot in this set" : `replacing ${plural(set.replace.length, "current screenshot")}`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="text-[color:var(--editor-color-text-secondary)]">Other localizations and display types are left as they are.</p>
      {skipped.length > 0 ? (
        <ul aria-label="Not uploaded" className="flex flex-col gap-1 text-[color:var(--editor-color-text-secondary)]">
          {skippedReasons(skipped).map((line) => <li key={line}>Not uploaded, {line}</li>)}
        </ul>
      ) : null}
      <p className="text-[color:var(--editor-color-text-secondary)]">
        {UPLOAD_SLOT_LIMITS.apple} The upload covers every Apple screen in this layout, not only the sizes and locales checked for export.
      </p>
      {plan.warnings.map((warning) => <StatusMessage key={warning} tone="warning">{warning}</StatusMessage>)}
    </div>
  );
}

/** Per store locale and image slot, from the offline plan. */
function GooglePlayPlanReview({ plan }: { plan: Extract<UploadPlanResponse, { store: "google" }> }) {
  const { locales, untouchedLocales, skipped } = plan.plan;
  return (
    <div className="flex flex-col gap-3 text-xs text-[color:var(--editor-color-text-default)]">
      <p>
        <span className="font-mono">{plan.identifier}</span> · layout <span className="font-mono">{plan.layoutId}</span>
      </p>
      <ul aria-label="Upload plan" className="flex flex-col gap-2">
        {locales.map((locale) => (
          <li key={locale.locale} className={editorUi.formPanel}>
            <h4 className="font-semibold text-[color:var(--editor-color-text-strong)]">
              {locale.locale} <span className="font-normal text-[color:var(--editor-color-text-secondary)]">from project locale {locale.projectLocale}</span>
            </h4>
            <ul className="flex flex-col gap-1">
              {locale.slots.map((slot) => (
                <li key={slot.imageType}>
                  <span className="font-medium">{slotLabel(slot.imageType)}</span>: uploads {plural(slot.upload.length, "image")} ({slot.upload.map(({ screenName }) => screenName).join(", ")}),{" "}
                  {slot.replace === null ? "replacing every current image in this slot" : `replacing ${plural(slot.replace.length, "current image")}`}
                </li>
              ))}
            </ul>
            {locale.untouchedSlots.length > 0 ? (
              <p className="text-[color:var(--editor-color-text-secondary)]">Left as they are: {locale.untouchedSlots.map(slotLabel).join(", ")}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-[color:var(--editor-color-text-secondary)]">
        {untouchedLocales === null || untouchedLocales.length === 0
          ? "Other store languages are left as they are."
          : `Left as they are: ${untouchedLocales.join(", ")}`}
      </p>
      {skipped.length > 0 ? (
        <p className="text-[color:var(--editor-color-text-secondary)]">Not uploaded, no store slot: {skippedSummary(skipped)}</p>
      ) : null}
      <p className="text-[color:var(--editor-color-text-secondary)]">
        {UPLOAD_SLOT_LIMITS.google} The upload covers every Android screen in this layout, not only the sizes and locales checked for export.
      </p>
      {plan.warnings.map((warning) => <StatusMessage key={warning} tone="warning">{warning}</StatusMessage>)}
    </div>
  );
}

/** The CLI's final report. */
export function UploadReportView({ report, warnings }: { report: UploadReport; warnings: readonly string[] }) {
  return report.store === "google"
    ? <GooglePlayReportView report={report} warnings={warnings} />
    : <AppStoreReportView report={report} warnings={warnings} />;
}

/** One state per screenshot set, since App Store Connect changes them one at a time. */
function AppStoreReportView({ report, warnings }: { report: AppStoreUploadReport; warnings: readonly string[] }) {
  const sets = report.locales.flatMap((locale) => locale.sets.map((set) => ({ locale, set })));
  const replaced = sets.filter(({ set }) => set.state === "replaced").length;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p role="status" className={editorUi.statusProgress}>
        Replaced {replaced} of {plural(sets.length, "screenshot set")} in app {report.appId}
        {report.versions.length > 0 ? ` (${report.versions.map(({ platform, versionString }) => `${platform} ${versionString}`).join(", ")})` : ""}.
      </p>
      <ul aria-label="Upload result" className="flex flex-col gap-1">
        {sets.map(({ locale, set }) => (
          <li key={`${locale.platform}/${locale.locale}/${set.displayType}`}>
            {locale.platform} {locale.locale} {set.displayType}: {set.state}{set.error ? ` (${set.error})` : ""}
          </li>
        ))}
      </ul>
      {sets.some(({ set }) => set.state === "partial" || set.state === "failed")
        ? <StatusMessage tone="warning">{NON_ATOMIC}</StatusMessage>
        : null}
      {warnings.map((warning) => <StatusMessage key={warning} tone="warning">{warning}</StatusMessage>)}
    </div>
  );
}

/** One committed edit, or nothing changed. */
function GooglePlayReportView({ report, warnings }: { report: GooglePlayUploadReport; warnings: readonly string[] }) {
  const images = uploadImageCount(report);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p role="status" className={editorUi.statusProgress}>
        {report.committed
          ? `Committed one edit to ${report.packageName}: ${plural(images, "image")} in ${plural(report.locales.length, "language")}.`
          : "Nothing was committed."}
      </p>
      <ul aria-label="Upload result" className="flex flex-col gap-1">
        {report.locales.flatMap((locale) => locale.slots.map((slot) => (
          <li key={`${locale.locale}/${slot.imageType}`}>
            {locale.locale} {slotLabel(slot.imageType)}: uploaded {slot.upload.length}
            {slot.replace === null ? "" : `, replaced ${slot.replace.length}`}
          </li>
        )))}
      </ul>
      {warnings.map((warning) => <StatusMessage key={warning} tone="warning">{warning}</StatusMessage>)}
    </div>
  );
}

type UploadError = { message: string; code?: string };

/** What blocks a confirm, with the Stores dialog as the place to fix it. */
export function missingStoreSetup(plan: UploadPlanResponse | null, error: UploadError | null): string | null {
  if (error?.code === "missing-identifier" || error?.code === "not-configured") return error.message;
  if (plan && !plan.credentialsConfigured) {
    return plan.store === "google"
      ? "Add the Google Play service account key in Stores before uploading."
      : "Add the App Store Connect API key in Stores before uploading.";
  }
  return null;
}

/** What else keeps the confirm disabled: an App Store version that is missing or not picked yet. */
export function uploadBlocked(plan: UploadPlanResponse): string | null {
  if (plan.store === "google" || plan.versions === null) return null;
  if (plan.blocked) return plan.blocked;
  return plan.versions.some(({ selected }) => selected === null) ? "Pick the App Store version to upload to." : null;
}

/**
 * Plan review, confirmation, progress and result for one store upload. The confirm sends the hash of
 * the plan shown here; the server refuses it when the project changed since.
 */
export function StoreUploadDialog({ layoutId, onClose, onOpenStores }: {
  layoutId: string;
  onClose: () => void;
  onOpenStores: () => void;
}) {
  const [store, setStore] = useState<UploadStoreId>(UPLOADABLE[0]!.id);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [plan, setPlan] = useState<UploadPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ExportProgressSnapshot | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [result, setResult] = useState<{ report: UploadReport; warnings: string[] } | null>(null);
  const [reviewKey, setReviewKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void withFlushedProject(() => requestUploadPlan(store, layoutId, version)).then(
      (next) => { if (!cancelled) setPlan(next); },
      (caught: Error) => {
        if (!cancelled) setError({ message: caught.message, code: caught instanceof StoreUploadRequestError ? caught.code : undefined });
      },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [store, layoutId, version, reviewKey]);

  // A picked version changes the plan and its hash, so the server issues a new one to confirm.
  const review = (nextStore: UploadStoreId, nextVersion?: string) => {
    setLoading(true);
    setPlan(null);
    setError(null);
    setResult(null);
    setStore(nextStore);
    setVersion(nextVersion);
    setReviewKey(reviewKey + 1);
  };
  const missing = missingStoreSetup(plan, error);
  const blocked = plan ? uploadBlocked(plan) : null;
  const confirm = async () => {
    if (!plan) return;
    const operationId = createExportOperationId();
    const total = uploadImageCount(plan.plan);
    setUploading(true);
    setError(null);
    setProgress({ operationId, phase: "preparing", completed: 0, total });
    const timer = window.setInterval(() => {
      void fetch(`/api/export/progress?operationId=${operationId}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((body: unknown) => {
          const snapshot = parseExportProgress(body);
          if (snapshot) setProgress(snapshot);
        })
        // Progress is auxiliary; the upload response decides success.
        .catch(() => undefined);
    }, 300);
    try {
      setResult(await startStoreUpload(plan, operationId));
    } catch (caught) {
      setError({ message: (caught as Error).message, code: caught instanceof StoreUploadRequestError ? caught.code : undefined });
    } finally {
      window.clearInterval(timer);
      setUploading(false);
      setPlan(null);
    }
  };

  return (
    <DialogShell
      title="Upload to store"
      description="Review what will be uploaded and replaced, then confirm. Nothing changes in the store until you confirm."
      onClose={onClose}
      closeDisabled={uploading}
      widthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <UploadCloud aria-hidden="true" className="size-4 text-[color:var(--editor-color-text-secondary)]" />
          <MenuSelect
            ariaLabel="Store"
            value={store}
            options={UPLOADABLE.map(({ id, label }) => ({ value: id, label }))}
            onChange={(next) => review(next)}
            className="w-48"
          />
        </div>
        {loading ? <p role="status" className={editorUi.statusProgress}>Building the upload plan…</p> : null}
        {plan && !result ? <UploadPlanReview plan={plan} onVersion={(next) => review(store, next)} /> : null}
        {missing ? (
          <div className="flex items-center gap-3">
            <StatusMessage tone="warning" className="flex-1">{missing}</StatusMessage>
            <button type="button" className={editorUi.buttonSecondary} onClick={onOpenStores}>Open Stores</button>
          </div>
        ) : error ? <StatusMessage tone="error">{error.message}</StatusMessage> : null}
        {uploading && progress ? <ExportProgressStatus progress={progress} /> : null}
        {result ? <UploadReportView report={result.report} warnings={result.warnings} /> : null}
        <div className="flex justify-end gap-2 border-t border-[var(--editor-color-border-subtle)] pt-4">
          <button className={editorUi.buttonSecondary} onClick={onClose} disabled={uploading}>Close</button>
          {!plan && !loading && !uploading && !result ? (
            <button className={editorUi.buttonSecondary} onClick={() => review(store, version)}>Review again</button>
          ) : null}
          {plan ? (
            <button className={editorUi.buttonPrimary} onClick={() => void confirm()} disabled={uploading || missing !== null || blocked !== null}>
              {uploading ? "Uploading…" : `Upload ${plural(uploadImageCount(plan.plan), "image")}`}
            </button>
          ) : null}
        </div>
      </div>
    </DialogShell>
  );
}
