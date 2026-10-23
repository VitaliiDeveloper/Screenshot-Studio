// SPDX-License-Identifier: Apache-2.0
"use client";

/**
 * Wraps only between ` · ` parts, so a device name or a pixel size never splits across lines. A part
 * ending in ` +N` (more devices than the title lists) shows that count as a muted chip.
 */
export function WrapAtSeparators({ text }: { text: string }) {
  const parts = text.split(" · ");
  return parts.map((part, index) => {
    const last = index === parts.length - 1;
    const more = /^(.*) (\+\d+)$/.exec(part);
    return (
      <span key={index}>
        <span className="whitespace-nowrap">
          {more ? (
            <>
              {more[1]}{" "}
              <span className="inline-block rounded-full border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-muted)] px-1.5 align-[1px] text-[10px] font-normal leading-4 text-[color:var(--editor-color-text-muted)]">
                {more[2]}
              </span>
            </>
          ) : part}
          {last ? null : " ·"}
        </span>
        {last ? null : " "}
      </span>
    );
  });
}
