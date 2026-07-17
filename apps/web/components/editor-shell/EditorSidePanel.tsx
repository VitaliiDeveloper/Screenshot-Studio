import React, { type ReactNode } from "react";
import { cx } from "../editor-ui";

export function EditorSidePanel({
  side,
  open,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-editor-side-panel={side}
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cx(
        "absolute inset-y-0 z-30 h-full w-[min(18rem,calc(100vw-3.5rem))] shrink-0 overflow-hidden transition-[width,translate,opacity] duration-200 ease-out motion-reduce:duration-0 xl:static xl:z-auto",
        side === "left" ? "left-14" : "right-0",
        open
          ? "translate-x-0 opacity-100 xl:w-72"
          : cx(
            "pointer-events-none opacity-0 xl:w-0",
            side === "left"
              ? "-translate-x-full xl:-translate-x-3"
              : "translate-x-full xl:translate-x-3",
          ),
      )}
    >
      <div className="h-full w-full xl:w-72">{children}</div>
    </div>
  );
}
