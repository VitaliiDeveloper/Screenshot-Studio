// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImageOff, Paperclip, X } from "lucide-react";
import { AGENT_ATTACHMENT_ACCEPT, MAX_AGENT_ATTACHMENTS } from "@web/lib/agents/agent-attachments";
import { attachmentFileProblem } from "./agent-panel-model";
import { cx, editorUi } from "./editor-ui";

/** A file waiting in the composer. A refused file has no thumbnail and says why next to its name. */
export interface ComposerAttachment {
  id: number;
  file: File;
  url: string | null;
  error: string | null;
}

const hint = "text-[11px] leading-[1.45] text-[color:var(--editor-color-text-secondary)]";
export const attachmentThumbnail = "size-10 shrink-0 rounded-md border border-[var(--editor-color-border)] object-cover";

export function useComposerAttachments() {
  const [items, setItems] = useState<ComposerAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(1);
  const reserved = useRef(0);
  const disposed = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Thumbnails use object URLs; they are freed when the file leaves the composer or the composer goes.
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      for (const { url } of itemsRef.current) if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const add = async (files: File[]) => {
    // Slots are reserved before the first await, so two quick drops cannot both claim the last one.
    const room = Math.max(0, MAX_AGENT_ATTACHMENTS - itemsRef.current.length - reserved.current);
    const accepted = files.slice(0, room);
    reserved.current += accepted.length;
    setNotice(files.length > accepted.length
      ? `Up to ${MAX_AGENT_ATTACHMENTS} images per message; ${files.length - accepted.length} not added.`
      : null);
    const checked = await Promise.all(accepted.map(async (file) => ({
      file,
      error: await attachmentFileProblem(file).catch(() => "This file cannot be read"),
    })));
    reserved.current -= accepted.length;
    if (disposed.current) return;
    setItems((current) => [...current, ...checked.map(({ file, error }): ComposerAttachment => ({
      id: nextId.current++, file, error, url: error ? null : URL.createObjectURL(file),
    }))]);
  };
  const remove = (id: number) => {
    const removed = itemsRef.current.find((item) => item.id === id);
    if (removed?.url) URL.revokeObjectURL(removed.url);
    setItems((current) => current.filter((item) => item.id !== id));
    setNotice(null);
  };
  /** Replaces every waiting image; an empty list clears the composer and frees its thumbnails. */
  const replace = (files: File[]) => {
    for (const { url } of itemsRef.current) if (url) URL.revokeObjectURL(url);
    setItems(files.map((file) => ({ id: nextId.current++, file, error: null, url: URL.createObjectURL(file) })));
    setNotice(null);
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...event.clipboardData.files];
    if (images.length === 0) return;
    // Text that came along with the image still pastes.
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    void add(images);
  };
  const hasFiles = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes("Files");
  const dropTarget = (enabled: boolean) => ({
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (enabled && hasFiles(event)) setDragging(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      void add([...event.dataTransfer.files]);
    },
  });

  return {
    items,
    notice,
    dragging,
    files: items.map(({ file }) => file),
    full: items.length >= MAX_AGENT_ATTACHMENTS,
    ready: items.length <= MAX_AGENT_ATTACHMENTS && items.every(({ error }) => !error),
    add,
    remove,
    replace,
    paste,
    dropTarget,
  };
}

export function ComposerAttachButton({ disabled, onFiles }: { disabled: boolean; onFiles(files: File[]): void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={AGENT_ATTACHMENT_ACCEPT}
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label="Attach images"
        title="Attach images (or drop or paste them)"
        className={cx(editorUi.buttonGhost, "!min-h-7 !px-1.5")}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden="true" size={14} />
      </button>
    </>
  );
}

export function ComposerAttachments({
  items,
  notice,
  onRemove,
}: {
  items: ComposerAttachment[];
  notice: string | null;
  onRemove: (id: number) => void;
}) {
  if (items.length === 0 && !notice) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 ? (
        <ul aria-label="Attached images" className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              {item.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.file.name} className={attachmentThumbnail} />
              ) : (
                <span aria-hidden="true" className={cx(attachmentThumbnail, "flex items-center justify-center text-[color:var(--editor-color-text-faint)]")}>
                  <ImageOff size={16} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs">{item.file.name}</span>
                {item.error ? <span role="alert" className="text-[11px] leading-[1.35] text-[color:var(--editor-color-danger-text)]">{item.error}</span> : null}
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.file.name}`}
                className={cx(editorUi.buttonGhost, "!min-h-6 !px-1.5")}
                onClick={() => onRemove(item.id)}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p role="status" className={hint}>{notice}</p> : null}
      {items.length > 0 ? (
        <p className={hint}>Attached images are sent to {`the agent's`} provider with your request, through your subscription.</p>
      ) : null}
    </div>
  );
}
