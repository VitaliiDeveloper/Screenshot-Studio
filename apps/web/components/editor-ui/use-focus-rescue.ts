// SPDX-License-Identifier: Apache-2.0
"use client";

import { useLayoutEffect, useRef, type FocusEvent } from "react";

/**
 * Moves focus to `fallback()` when a commit removes the focused control, because focus on `<body>`
 * hands the keyboard to the canvas shortcuts, which nudge and delete the selection. Spread the
 * returned handlers on the container. React does not deliver the blur of a node it removes, so
 * `focused` still names that node after the commit.
 */
export function useFocusRescue(fallback: () => HTMLElement | null | undefined) {
  const focused = useRef<EventTarget | null>(null);

  useLayoutEffect(() => {
    if (focused.current instanceof Node && !focused.current.isConnected) {
      focused.current = null;
      fallback()?.focus();
    }
  });

  return {
    onFocusCapture: (event: FocusEvent) => { focused.current = event.target; },
    onBlurCapture: () => { focused.current = null; },
  };
}
