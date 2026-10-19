// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useStore } from "zustand";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore } from "@web/lib/editor/editor-store";
import { compactStoreSizeLabel, storeOutputLabel } from "@web/lib/editor/editor-workspace";
import { cx, DialogShell, editorUi } from "@web/components/editor-ui";
import { EditorStage } from "@web/components/EditorStage";
import {
  initialPlayback,
  nearestSlideIndex,
  PLAY_INTERVAL_MS,
  playbackReducer,
  playEntries,
} from "./play-gallery-model";

const SLIDE_GAP = 24;
const SLIDE_PADDING_Y = 24;
// Keeps a slide narrower than the viewport so the neighbouring screens' edges stay visible.
const SLIDE_MAX_WIDTH_RATIO = 0.78;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Read-only store-style gallery of the screens one export writes for the current output. */
export function PlayGalleryDialog({
  images,
  specs,
  onClose,
}: {
  images: ImageCache;
  specs: StoreSpecs;
  onClose: () => void;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const layoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const entries = useMemo(
    () => playEntries(project, layoutId, activeScreenId, specs),
    [activeScreenId, layoutId, project, specs],
  );
  const count = entries.length;
  const reducer = useMemo(() => playbackReducer(count), [count]);
  const [{ index, playing }, dispatch] = useReducer(reducer, count, initialPlayback);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setViewport({ width: scroller.clientWidth, height: scroller.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const zooms = entries.map(({ screen }) => Math.max(0, Math.min(
    (viewport.height - SLIDE_PADDING_Y * 2) / screen.artboard.height,
    (viewport.width * SLIDE_MAX_WIDTH_RATIO) / screen.artboard.width,
  )));
  const slideWidth = (slide: number) => entries[slide]!.screen.artboard.width * zooms[slide]!;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => dispatch({ type: "tick" }), PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, playing]);

  const measured = viewport.width > 0;
  useEffect(() => {
    const slide = scrollerRef.current?.querySelectorAll<HTMLElement>("[data-play-slide]")[index];
    if (!measured || !slide) return;
    scrollerRef.current!.scrollTo({
      left: slide.offsetLeft - (viewport.width - slide.offsetWidth) / 2,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [index, measured, viewport.width]);

  // Swipe and trackpad scrolling settle on a snap point; the index follows once scrolling stops.
  const settleTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);
  const onScroll = () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const centers = Array.from(scroller.querySelectorAll<HTMLElement>("[data-play-slide]"))
        .map((slide) => slide.offsetLeft + slide.offsetWidth / 2);
      dispatch({ type: "scrolled", index: nearestSlideIndex(centers, scroller.scrollLeft + scroller.clientWidth / 2) });
    }, 120);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        dispatch({ type: "go", index: index + (event.key === "ArrowLeft" ? -1 : 1) });
      } else if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        dispatch({ type: "toggle" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index]);

  const current = entries[index];
  const description = current
    ? [
      storeOutputLabel(current.screen.platform, current.screen.device, specs),
      compactStoreSizeLabel(current.target.label, current.screen.device),
      current.screen.locale,
    ].join(" · ")
    : "No screens to play for this output.";
  const atStart = index === 0;
  const atEnd = index >= count - 1;
  const navButton = cx(editorUi.iconButton, "aria-disabled:pointer-events-none aria-disabled:opacity-35");

  return (
    <DialogShell
      title="Play"
      description={description}
      initialFocus="heading"
      closeLabel="Close play"
      widthClass="h-full !max-h-none max-w-none"
      bodyClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !p-0"
      onClose={onClose}
    >
      <div
        ref={scrollerRef}
        data-testid="play-gallery"
        role="region"
        aria-roledescription="carousel"
        aria-label="Screens"
        className="relative flex min-h-0 flex-1 snap-x snap-mandatory items-center overflow-x-auto overscroll-x-contain bg-[var(--editor-color-surface-muted)]"
        style={{
          gap: SLIDE_GAP,
          paddingInline: count > 0 && measured
            ? `${(viewport.width - slideWidth(0)) / 2}px ${(viewport.width - slideWidth(count - 1)) / 2}px`
            : undefined,
        }}
        onScroll={onScroll}
        onWheel={() => dispatch({ type: "pause" })}
        onPointerDown={() => dispatch({ type: "pause" })}
      >
        {measured ? entries.map(({ screen }, slide) => (
          <div
            key={screen.id}
            data-play-slide
            role="group"
            aria-roledescription="slide"
            aria-label={`${slide + 1} of ${count}: ${screen.name}`}
            aria-current={slide === index ? "true" : undefined}
            className="relative shrink-0 snap-center bg-white shadow-[0_8px_28px_rgba(15,23,42,0.12)] ring-1 ring-slate-300"
            style={{ width: slideWidth(slide) }}
          >
            <EditorStage images={images} zoom={zooms[slide]} screenId={screen.id} interactive={false} />
          </div>
        )) : null}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-[var(--editor-color-surface-muted)] px-4 py-3">
        <button
          type="button"
          aria-label="Previous screen"
          aria-disabled={atStart || undefined}
          className={navButton}
          onClick={() => dispatch({ type: "go", index: index - 1 })}
        >
          <ChevronLeft size={16} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause autoplay" : "Start autoplay"}
          disabled={count < 2}
          className={editorUi.iconButton}
          onClick={() => dispatch({ type: "toggle" })}
        >
          {playing ? <Pause size={16} strokeWidth={1.9} /> : <Play size={16} strokeWidth={1.9} />}
        </button>
        <button
          type="button"
          aria-label="Next screen"
          aria-disabled={atEnd || undefined}
          className={navButton}
          onClick={() => dispatch({ type: "go", index: index + 1 })}
        >
          <ChevronRight size={16} strokeWidth={1.9} />
        </button>
        <p className="min-w-12 text-center text-xs font-medium tabular-nums text-[color:var(--editor-color-text-secondary)]">
          <span aria-hidden="true">{count > 0 ? `${index + 1} / ${count}` : "0 / 0"}</span>
          <span className="sr-only" aria-live="polite">
            {current ? `Screen ${index + 1} of ${count}: ${current.screen.name}` : ""}
          </span>
        </p>
      </div>
    </DialogShell>
  );
}
