// SPDX-License-Identifier: Apache-2.0
"use client";

/** Wraps only between ` · ` parts, so a device name or a pixel size never splits across lines. */
export function WrapAtSeparators({ text }: { text: string }) {
  const parts = text.split(" · ");
  return parts.map((part, index) => (
    <span key={index}>
      <span className="whitespace-nowrap">{index < parts.length - 1 ? `${part} ·` : part}</span>
      {index < parts.length - 1 ? " " : null}
    </span>
  ));
}
