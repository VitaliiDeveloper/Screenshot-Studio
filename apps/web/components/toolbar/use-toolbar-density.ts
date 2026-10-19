// SPDX-License-Identifier: Apache-2.0
"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  nextToolbarDensity,
  toolbarGap,
  resolveToolbarDensityProbe,
  toolbarDensityProbeTarget,
  type ToolbarDensity,
} from "./toolbar-density";

const MAX_CACHED_CONTEXTS = 12;

interface ToolbarWidths {
  headerWidth: number;
  leftWidth: number;
  centerWidth: number;
  rightWidth: number;
}

type ToolbarDensityTransitionFocusTarget = "overflow-trigger" | "export" | null;

export function toolbarDensityProbeFocusRestoration({
  fallbackDensity,
  candidateDensity,
  resolvedDensity,
  fallbackFocusTarget,
}: {
  fallbackDensity: ToolbarDensity;
  candidateDensity: ToolbarDensity;
  resolvedDensity: ToolbarDensity;
  fallbackFocusTarget: ToolbarDensityTransitionFocusTarget;
}): ToolbarDensityTransitionFocusTarget {
  return resolvedDensity === fallbackDensity && resolvedDensity !== candidateDensity
    ? fallbackFocusTarget
    : null;
}

export function toolbarDensityTransitionFocusPolicy({
  nextDensity,
  overflowOpen,
  focusWithinOverflow,
  focusedItemRole,
}: {
  nextDensity: ToolbarDensity;
  overflowOpen: boolean;
  focusWithinOverflow: boolean;
  focusedItemRole: string | null;
}): {
  closeOverflow: boolean;
  focusTarget: ToolbarDensityTransitionFocusTarget;
} {
  const overflowRemoved = nextDensity === "full" || nextDensity === "compact";
  const focusedLocaleRadioRemoved =
    nextDensity === "overflow-secondary"
    && focusWithinOverflow
    && focusedItemRole === "menuitemradio";

  return {
    closeOverflow: overflowOpen && (overflowRemoved || focusedLocaleRadioRemoved),
    focusTarget: overflowRemoved && focusWithinOverflow
      ? "export"
      : focusedLocaleRadioRemoved
        ? "overflow-trigger"
        : null,
  };
}

function targetWidth(root: HTMLElement, labelsExpanded: boolean): number {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-label]"))
    .filter((label) => getComputedStyle(label).display !== "none")
    .reduce(
      (width, label) => labelsExpanded
        ? width + Math.max(0, label.scrollWidth - label.clientWidth)
        : width - label.clientWidth,
      root.scrollWidth,
    );
}

/**
 * Measures the toolbar's three groups and steps through the five density states, keeping focus on
 * a control that survives each transition. `measurementContentKey` must change whenever toolbar
 * content width can change (see `toolbarMeasurementKey`).
 */
export function useToolbarDensity(measurementContentKey: string) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [density, setDensity] = useState<ToolbarDensity>("full");
  const [densityReady, setDensityReady] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const viewSwitchRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowOpenRef = useRef(false);
  const densityProbeRef = useRef<{
    fallbackDensity: ToolbarDensity;
    candidateDensity: ToolbarDensity;
    fallbackFocusTarget: ToolbarDensityTransitionFocusTarget;
  } | null>(null);
  const pendingDensityFocusRef = useRef<ToolbarDensityTransitionFocusTarget>(null);
  const measurementCacheRef = useRef<{
    contentKey: string;
    widthsByContext: Map<ToolbarDensity, Map<string, ToolbarWidths>>;
  }>({ contentKey: "", widthsByContext: new Map() });

  useLayoutEffect(() => {
    overflowOpenRef.current = overflowOpen;
  }, [overflowOpen]);

  useLayoutEffect(() => {
    const pendingFocusTarget = pendingDensityFocusRef.current;
    pendingDensityFocusRef.current = null;
    if (pendingFocusTarget === "overflow-trigger") {
      overflowTriggerRef.current?.focus();
    } else if (pendingFocusTarget === "export") {
      exportRef.current?.focus();
    }
  }, [density]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const left = leftRef.current;
    const viewSwitch = viewSwitchRef.current;
    const right = rightRef.current;
    if (!header || !left || !viewSwitch || !right) return;

    const cache = measurementCacheRef.current;
    if (cache.contentKey !== measurementContentKey) {
      cache.contentKey = measurementContentKey;
      cache.widthsByContext.clear();
      densityProbeRef.current = null;
      pendingDensityFocusRef.current = null;
    }

    let frame = 0;
    const sync = () => {
      const style = getComputedStyle(header);
      const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const columnGap = Number.parseFloat(style.columnGap) || 0;
      const labelsExpanded = density === "full";
      const currentWidths: ToolbarWidths = {
        headerWidth: header.clientWidth,
        leftWidth: targetWidth(left, labelsExpanded),
        centerWidth: targetWidth(viewSwitch, labelsExpanded),
        rightWidth: targetWidth(right, labelsExpanded),
      };
      const measurementContextKey = `${currentWidths.headerWidth}:${window.innerWidth}`;
      const widthsAtContexts = cache.widthsByContext.get(density) ?? new Map<string, ToolbarWidths>();
      widthsAtContexts.delete(measurementContextKey);
      widthsAtContexts.set(measurementContextKey, currentWidths);
      while (widthsAtContexts.size > MAX_CACHED_CONTEXTS) {
        const oldestContext = widthsAtContexts.keys().next().value;
        if (oldestContext === undefined) break;
        widthsAtContexts.delete(oldestContext);
      }
      cache.widthsByContext.set(density, widthsAtContexts);

      const gapFor = (widths: ToolbarWidths) => toolbarGap({
        headerWidth: currentWidths.headerWidth,
        horizontalPadding,
        columnGap,
        leftWidth: widths.leftWidth,
        centerWidth: widths.centerWidth,
        rightWidth: widths.rightWidth,
      });
      const currentGap = gapFor(currentWidths);
      const transitionTo = (nextDensity: ToolbarDensity) => {
        const focusWithinOverflow = overflowRef.current?.contains(document.activeElement) ?? false;
        const { closeOverflow, focusTarget } = toolbarDensityTransitionFocusPolicy({
          nextDensity,
          overflowOpen: overflowOpenRef.current,
          focusWithinOverflow,
          focusedItemRole: focusWithinOverflow
            ? document.activeElement?.getAttribute("role") ?? null
            : null,
        });
        if (closeOverflow) setOverflowOpen(false);
        if (focusTarget === "overflow-trigger") {
          overflowTriggerRef.current?.focus();
        } else if (focusTarget === "export") {
          exportRef.current?.focus();
        }
        setDensity(nextDensity);
        return focusTarget;
      };

      const activeProbe = densityProbeRef.current;
      if (activeProbe?.candidateDensity === density) {
        densityProbeRef.current = null;
        const resolvedDensity = resolveToolbarDensityProbe({
          ...activeProbe,
          candidateGap: currentGap,
        });
        pendingDensityFocusRef.current = toolbarDensityProbeFocusRestoration({
          ...activeProbe,
          resolvedDensity,
        });
        if (resolvedDensity !== density) {
          transitionTo(resolvedDensity);
          return;
        }
      } else if (activeProbe) {
        densityProbeRef.current = null;
      }

      const previousDensity = toolbarDensityProbeTarget(density);
      const previousWidths = previousDensity
        ? cache.widthsByContext.get(previousDensity)?.get(measurementContextKey)
        : null;
      const nextDensity = nextToolbarDensity({
        density,
        currentGap,
        previousGap: previousWidths ? gapFor(previousWidths) : null,
      });

      if (nextDensity !== density) {
        transitionTo(nextDensity);
        return;
      }

      if (previousDensity && !previousWidths) {
        const probe = {
          fallbackDensity: density,
          candidateDensity: previousDensity,
          fallbackFocusTarget: null as ToolbarDensityTransitionFocusTarget,
        };
        const transitionFocusTarget = transitionTo(previousDensity);
        probe.fallbackFocusTarget = transitionFocusTarget === "export"
          ? "overflow-trigger"
          : null;
        densityProbeRef.current = probe;
        return;
      }

      setDensityReady(true);
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    sync();
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(header);
    observer.observe(left);
    observer.observe(viewSwitch);
    observer.observe(right);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [density, measurementContentKey]);

  return {
    density,
    densityReady,
    overflowOpen,
    setOverflowOpen,
    headerRef,
    leftRef,
    viewSwitchRef,
    rightRef,
    exportRef,
    overflowRef,
    overflowTriggerRef,
  };
}
