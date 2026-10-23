// SPDX-License-Identifier: Apache-2.0
"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useStore } from "zustand";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore } from "@web/lib/editor/editor-store";
import { compactStoreSizeLabel, storeOutputLabel } from "@web/lib/editor/editor-workspace";
import { cx, DialogShell, editorUi } from "@web/components/editor-ui";
import { EditorStage } from "@web/components/EditorStage";
import {
  centeredTrackX,
  initialPlayback,
  PLAY_INTERVAL_MS,
  playbackReducer,
  playEntries,
  swipeStep,
  wheelScrollsSideways,
} from "./play-gallery-model";

const SLIDE_PADDING_Y = 12;
const NARROW_VIEWPORT = 640;
const WHEEL_STEP_DISTANCE = 50;
// One trackpad gesture keeps emitting inertial wheel events; it advances once until they stop.
const WHEEL_GESTURE_IDLE_MS = 220;
const CLICK_SLOP = 6;
const motion = "duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Read-only, full-screen scene of the screens one export writes for the current output. */
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
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setViewport({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const measured = viewport.width > 0;
  const narrow = viewport.width < NARROW_VIEWPORT;
  const gap = narrow ? 16 : 40;
  // Keeps the current screen narrow enough that both neighbours stay visible beside it.
  const maxWidthRatio = narrow ? 0.72 : 0.6;
  const zooms = entries.map(({ screen }) => Math.max(0, Math.min(
    (viewport.height - SLIDE_PADDING_Y * 2) / screen.artboard.height,
    (viewport.width * maxWidthRatio) / screen.artboard.width,
  )));
  const widths = entries.map(({ screen }, slide) => screen.artboard.width * zooms[slide]!);
  const trackX = centeredTrackX(widths, gap, index, viewport.width);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => dispatch({ type: "tick" }), PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, playing]);

  const progressRefs = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    const fill = progressRefs.current[index];
    if (!playing || !fill || reducedMotion()) return;
    const animation = fill.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: PLAY_INTERVAL_MS, easing: "linear", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [index, playing]);

  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX };
    setDragOffset(0);
    dispatch({ type: "pause" });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) setDragOffset(event.clientX - drag.startX);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragOffset(null);
    const offset = event.clientX - drag.startX;
    if (event.type === "pointerup" && Math.abs(offset) < CLICK_SLOP) {
      // Pointer capture retargets the event to the stage, so hit-test the slide under the pointer.
      const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-play-slide]");
      if (hit) dispatch({ type: "go", index: Number(hit.dataset.playSlide) });
      return;
    }
    const step = swipeStep(-offset, Math.min(80, (widths[index] ?? 0) * 0.2));
    if (step !== 0) dispatch({ type: "go", index: index + step });
  };

  const wheelRef = useRef<{ travel: number; stepped: boolean; timer: number | null }>({
    travel: 0,
    stepped: false,
    timer: null,
  });
  useEffect(() => () => {
    if (wheelRef.current.timer !== null) window.clearTimeout(wheelRef.current.timer);
  }, []);
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!wheelScrollsSideways(event)) return;
    const wheel = wheelRef.current;
    if (wheel.timer !== null) window.clearTimeout(wheel.timer);
    wheel.timer = window.setTimeout(() => {
      wheel.travel = 0;
      wheel.stepped = false;
      wheel.timer = null;
    }, WHEEL_GESTURE_IDLE_MS);
    dispatch({ type: "pause" });
    if (wheel.stepped) return;
    wheel.travel += event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    const step = swipeStep(wheel.travel, WHEEL_STEP_DISTANCE);
    if (step === 0) return;
    wheel.stepped = true;
    dispatch({ type: "go", index: index + step });
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
  const controlButton = cx(
    editorUi.iconButton,
    "!size-10 !rounded-full bg-[var(--editor-color-surface-muted)] aria-disabled:pointer-events-none aria-disabled:opacity-35",
  );

  return (
    <DialogShell
      title="Play"
      description={description}
      initialFocus="heading"
      closeLabel="Close play"
      widthClass="h-full !max-h-none max-w-none outline-none"
      bodyClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !p-0"
      onClose={onClose}
    >
      <div className="flex gap-1.5 px-4 py-2 sm:px-5">
        {entries.map(({ screen }, slide) => (
          <button
            key={screen.id}
            type="button"
            aria-label={`Go to screen ${slide + 1}: ${screen.name}`}
            aria-current={slide === index ? "true" : undefined}
            className="flex h-5 min-w-0 flex-1 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]"
            onClick={() => dispatch({ type: "go", index: slide })}
          >
            <span className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--editor-color-border)]">
              <span
                ref={(element) => { progressRefs.current[slide] = element; }}
                className="block h-full origin-left bg-[var(--editor-color-accent)]"
                style={{ transform: `scaleX(${slide < index || (slide === index && !playing) ? 1 : 0})` }}
              />
            </span>
          </button>
        ))}
      </div>
      <div
        ref={stageRef}
        data-testid="play-gallery"
        role="region"
        aria-roledescription="carousel"
        aria-label="Screens"
        className="relative min-h-0 flex-1 touch-pan-y select-none overflow-hidden overscroll-x-none bg-[var(--editor-color-surface-subtle)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={onWheel}
      >
        {measured ? (
          <div
            className={cx("absolute inset-y-0 left-0 flex items-center", dragOffset === null && cx("transition-transform", motion))}
            style={{ gap, transform: `translateX(${trackX + (dragOffset ?? 0)}px)` }}
          >
            {entries.map(({ screen }, slide) => (
              <div
                key={screen.id}
                data-play-slide={slide}
                role="group"
                aria-roledescription="slide"
                aria-label={`${slide + 1} of ${count}: ${screen.name}`}
                aria-current={slide === index ? "true" : undefined}
                className={cx(
                  "relative shrink-0 overflow-hidden rounded-lg bg-[var(--editor-color-surface)] shadow-[var(--editor-shadow-menu)] ring-1 ring-[var(--editor-color-border)] transition-[transform,opacity]",
                  motion,
                  slide === index ? "opacity-100" : "scale-[0.86] cursor-pointer opacity-40",
                )}
                style={{ width: widths[slide] }}
              >
                <EditorStage images={images} zoom={zooms[slide]} screenId={screen.id} interactive={false} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-center gap-3 border-t border-[var(--editor-color-border)] px-4 py-3">
        <button
          type="button"
          aria-label="Previous screen"
          aria-disabled={index === 0 || undefined}
          className={controlButton}
          onClick={() => dispatch({ type: "go", index: index - 1 })}
        >
          <ChevronLeft size={18} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause autoplay" : "Start autoplay"}
          disabled={count < 2}
          className={controlButton}
          onClick={() => dispatch({ type: "toggle" })}
        >
          {playing ? <Pause size={18} strokeWidth={1.9} /> : <Play size={18} strokeWidth={1.9} />}
        </button>
        <button
          type="button"
          aria-label="Next screen"
          aria-disabled={index >= count - 1 || undefined}
          className={controlButton}
          onClick={() => dispatch({ type: "go", index: index + 1 })}
        >
          <ChevronRight size={18} strokeWidth={1.9} />
        </button>
        <p className="sr-only" aria-live="polite">
          {current ? `Screen ${index + 1} of ${count}: ${current.screen.name}` : ""}
        </p>
      </div>
    </DialogShell>
  );
}
