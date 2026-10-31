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
  UPLOAD_SLOT_LIMITS,
  UPLOAD_STORES,
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

const UPLOADABLE = UPLOAD_STORES.filter((entry): entry is Extract<(typeof UPLOAD_STORES)[number], { id: UploadStoreId }> => entry.uploads);

/** What the confirmed upload will do, per store locale and image slot, from the offline plan. */
export function UploadPlanReview({ plan }: { plan: UploadPlanResponse }) {
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
        {UPLOAD_SLOT_LIMITS} The upload covers every Android screen in this layout, not only the sizes and locales checked for export.
      </p>
      {plan.warnings.map((warning) => <StatusMessage key={warning} tone="warning">{warning}</StatusMessage>)}
    </div>
  );
}

/** The CLI's final report: one committed edit, or nothing changed. */
export function UploadReportView({ report, warnings }: { report: UploadReport; warnings: readonly string[] }) {
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
  if (plan && !plan.credentialsConfigured) return "Add the Google Play service account key in Stores before uploading.";
  return null;
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
  const [plan, setPlan] = useState<UploadPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ExportProgressSnapshot | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [result, setResult] = useState<{ report: UploadReport; warnings: string[] } | null>(null);
  const [reviewKey, setReviewKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void withFlushedProject(() => requestUploadPlan(store, layoutId)).then(
      (next) => { if (!cancelled) setPlan(next); },
      (caught: Error) => {
        if (!cancelled) setError({ message: caught.message, code: caught instanceof StoreUploadRequestError ? caught.code : undefined });
      },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [store, layoutId, reviewKey]);

  const review = (nextStore: UploadStoreId) => {
    setLoading(true);
    setPlan(null);
    setError(null);
    setResult(null);
    setStore(nextStore);
    setReviewKey(reviewKey + 1);
  };
  const missing = missingStoreSetup(plan, error);
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
            onChange={review}
            className="w-48"
          />
        </div>
        {loading ? <p role="status" className={editorUi.statusProgress}>Building the upload plan…</p> : null}
        {plan && !result ? <UploadPlanReview plan={plan} /> : null}
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
            <button className={editorUi.buttonSecondary} onClick={() => review(store)}>Review again</button>
          ) : null}
          {plan ? (
            <button className={editorUi.buttonPrimary} onClick={() => void confirm()} disabled={uploading || missing !== null}>
              {uploading ? "Uploading…" : `Upload ${plural(uploadImageCount(plan.plan), "image")}`}
            </button>
          ) : null}
        </div>
      </div>
    </DialogShell>
  );
}
