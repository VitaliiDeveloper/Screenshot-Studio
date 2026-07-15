// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import {
  ProjectFontRegistrationError,
  registerProjectFonts,
  type FontRegistrationFailure,
} from "@screenshot-studio/core/fonts";
import { collectImageUrls, loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore } from "../../lib/editor-store";
import { requireProjectRevision, setProjectRevision } from "../../lib/save-project";
import { withFlushedProject } from "../../lib/debounced-save";

const resolveAsset = (assetUrl: string) => `/api/asset?path=${encodeURIComponent(assetUrl)}`;

export function missingImageUrls(project: Project, images: ImageCache): string[] {
  return collectImageUrls(project).filter((assetUrl) => !images.has(assetUrl));
}

export interface EditorResourceResult {
  project: Project;
  revision: string;
  images: ImageCache;
  specs: StoreSpecs;
  fontWarnings: FontRegistrationFailure[];
}

export interface EditorResourceDependencies {
  fetchProject?: () => Promise<Response>;
  loadImages?: (project: Project) => Promise<ImageCache>;
  registerFonts?: (fonts: Project["fonts"]) => Promise<void>;
  fetchStoreSpecs?: () => Promise<Response>;
}

export type EditorResourceSerializer = <T>(operation: () => Promise<T>) => Promise<T>;

export interface EditorResourceReloadOptions {
  serialize: EditorResourceSerializer;
  load: () => Promise<EditorResourceResult>;
  apply: (resources: EditorResourceResult) => void;
  isCurrent: () => boolean;
}

const runDirectly: EditorResourceSerializer = (operation) => operation();

export function selectEditorResourceSerializer(
  projectLoaded: boolean,
  serializers: {
    direct?: EditorResourceSerializer;
    flushed?: EditorResourceSerializer;
  } = {},
): EditorResourceSerializer {
  return projectLoaded
    ? serializers.flushed ?? withFlushedProject
    : serializers.direct ?? runDirectly;
}

export async function runEditorResourceReload(
  options: EditorResourceReloadOptions,
): Promise<boolean> {
  return options.serialize(async () => {
    const resources = await options.load();
    if (!options.isCurrent()) return false;
    options.apply(resources);
    return true;
  });
}

export async function loadProjectFontWarnings(
  fonts: Project["fonts"],
  registerFonts: (fonts: Project["fonts"]) => Promise<void> = (
    projectFonts,
  ) => registerProjectFonts(projectFonts, resolveAsset),
): Promise<FontRegistrationFailure[]> {
  try {
    await registerFonts(fonts);
    return [];
  } catch (error) {
    if (!(error instanceof ProjectFontRegistrationError)) throw error;
    return error.failures;
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof body.error === "string" ? body.error : `${fallback} (${response.status})`);
}

export async function loadEditorResources(
  dependencies: EditorResourceDependencies = {},
): Promise<EditorResourceResult> {
  const fetchProject = dependencies.fetchProject ?? (() => fetch("/api/project"));
  const loadImages = dependencies.loadImages
    ?? ((project: Project) => loadProjectImages(project, resolveAsset));
  const registerFonts = dependencies.registerFonts
    ?? ((fonts: Project["fonts"]) => registerProjectFonts(fonts, resolveAsset));
  const fetchStoreSpecs = dependencies.fetchStoreSpecs ?? (() => fetch("/api/store-specs"));

  const projectResponse = await fetchProject();
  if (!projectResponse.ok) throw await responseError(projectResponse, "Failed to load project");
  const revision = requireProjectRevision(projectResponse.headers.get("etag"));
  const project = parseProject(await projectResponse.json());
  const images = await loadImages(project);

  const fontWarnings = await loadProjectFontWarnings(project.fonts, registerFonts);

  const specsResponse = await fetchStoreSpecs();
  if (!specsResponse.ok) throw await responseError(specsResponse, "Failed to load store specs");
  const specs = parseStoreSpecs(await specsResponse.json());

  return { project, revision, images, specs, fontWarnings };
}

export function useEditorResources() {
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageCache | null>(null);
  const [specs, setSpecs] = useState<StoreSpecs | null>(null);
  const [fontWarnings, setFontWarnings] = useState<FontRegistrationFailure[]>([]);
  const [reloading, setReloading] = useState(false);
  const [fontRetrying, setFontRetrying] = useState(false);
  const resourceGeneration = useRef(0);
  const fontGeneration = useRef(0);
  const assetSignature = useStore(editorStore, (state) =>
    state.project ? collectImageUrls(state.project).sort().join("\n") : "",
  );

  const startReload = useCallback((serialize: EditorResourceSerializer) => {
    const generation = ++resourceGeneration.current;
    ++fontGeneration.current;
    setError(null);
    setImages(null);
    setSpecs(null);
    setFontWarnings([]);
    setReloading(true);
    void runEditorResourceReload({
      serialize,
      load: loadEditorResources,
      isCurrent: () => resourceGeneration.current === generation,
      apply: (resources) => {
        // A revision becomes globally usable only after every required resource validated and this
        // generation won. Cancelled or delayed fetches cannot roll the save coordinator backwards.
        setProjectRevision(resources.revision);
        editorStore.getState().load(resources.project);
        setImages(resources.images);
        setSpecs(resources.specs);
        setFontWarnings(resources.fontWarnings);
      },
    }).catch((error: unknown) => {
      if (resourceGeneration.current === generation) setError((error as Error).message);
    }).finally(() => {
      if (resourceGeneration.current === generation) setReloading(false);
    });
  }, []);

  const cancelLoads = useCallback(() => {
    ++resourceGeneration.current;
    ++fontGeneration.current;
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        startReload(selectEditorResourceSerializer(editorStore.getState().project !== null));
      }
    });
    return () => {
      active = false;
      cancelLoads();
    };
  }, [cancelLoads, startReload]);

  useEffect(() => {
    if (!images || !assetSignature) return;
    const project = editorStore.getState().project;
    if (!project) return;
    const missing = missingImageUrls(project, images);
    if (missing.length === 0) return;
    let cancelled = false;
    void loadProjectImages(project, resolveAsset).then((loaded) => {
      if (cancelled) return;
      setImages((current) => {
        if (!current) return loaded;
        const next = new Map(current);
        let changed = false;
        for (const assetUrl of missing) {
          const image = loaded.get(assetUrl);
          if (image) {
            next.set(assetUrl, image);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    return () => { cancelled = true; };
  }, [assetSignature, images]);

  const retry = useCallback(() => {
    if (reloading) return;
    const serialize = selectEditorResourceSerializer(editorStore.getState().project !== null);
    startReload(serialize);
  }, [reloading, startReload]);

  const retryFonts = useCallback(() => {
    if (fontRetrying) return;
    const project = editorStore.getState().project;
    if (!project) return;
    const signature = JSON.stringify(project.fonts);
    const generation = ++fontGeneration.current;
    setFontRetrying(true);
    void loadProjectFontWarnings(project.fonts).then((warnings) => {
      if (fontGeneration.current !== generation) return;
      const current = editorStore.getState().project;
      if (!current || JSON.stringify(current.fonts) !== signature) return;
      setFontWarnings(warnings);
    }).catch((error: unknown) => {
      if (fontGeneration.current === generation) setError((error as Error).message);
    }).finally(() => {
      if (fontGeneration.current === generation) setFontRetrying(false);
    });
  }, [fontRetrying]);

  return {
    error,
    images,
    specs,
    fontWarnings,
    retry,
    reloading,
    retryFonts,
    fontRetrying,
  };
}
