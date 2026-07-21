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
import {
  collectImageUrls,
  loadProjectImage,
  loadProjectImages,
  type ImageCache,
} from "@screenshot-studio/core/assets";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore } from "../../lib/editor-store";
import {
  readActiveLayoutPreference,
  writeActiveLayoutPreference,
} from "../../lib/editor-layout-preference";
import {
  createProjectAssetResolver,
  getProjectPersistenceIdentity,
  requireProjectRevision,
  resolveActiveProjectAssetUrl,
  setProjectPersistenceIdentity,
  type ProjectAssetResolver,
} from "../../lib/save-project";
import { withFlushedProject } from "../../lib/debounced-save";

async function loadAllProjectImages(
  project: Project,
  resolveAsset: ProjectAssetResolver,
): Promise<ImageCache> {
  const caches = await Promise.all(
    project.layouts.map((layout) => loadProjectImages(project, layout.id, resolveAsset)),
  );
  return new Map(caches.flatMap((cache) => [...cache]));
}

export function missingImageUrls(project: Project, images: ImageCache): string[] {
  return collectImageUrls(project).filter((assetUrl) => !images.has(assetUrl));
}

export function cacheDecodedProjectImage(
  images: ImageCache,
  assetUrl: string,
  image: HTMLImageElement,
): ImageCache {
  // Update the shared cache before publishing a new Map so a synchronous project mutation cannot
  // render one frame with a missing-image placeholder.
  images.set(assetUrl, image);
  return new Map(images);
}

export interface EditorResourceResult {
  project: Project;
  projectId: string;
  revision: string;
  images: ImageCache;
  specs: StoreSpecs;
  fontWarnings: FontRegistrationFailure[];
}

export interface EditorResourceDependencies {
  fetchProject?: () => Promise<Response>;
  loadImages?: (project: Project, resolveAsset: ProjectAssetResolver) => Promise<ImageCache>;
  registerFonts?: (
    fonts: Project["fonts"],
    resolveAsset: ProjectAssetResolver,
  ) => Promise<void>;
  fetchStoreSpecs?: () => Promise<Response>;
}

export type EditorResourceSerializer = <T>(operation: () => Promise<T>) => Promise<T>;

export interface EditorResourceReloadOptions {
  serialize: EditorResourceSerializer;
  load: () => Promise<EditorResourceResult>;
  apply: (resources: EditorResourceResult) => void;
  isCurrent: () => boolean;
}

export function applyEditorResourceResult(
  resources: EditorResourceResult,
  dependencies: {
    readLayoutPreference?: (projectId: string) => string | null;
  } = {},
): void {
  const sameProject = getProjectPersistenceIdentity()?.projectId === resources.projectId
    && editorStore.getState().project !== null;
  setProjectPersistenceIdentity(resources.projectId, resources.revision);
  if (sameProject) {
    editorStore.getState().reloadProject(resources.project);
    return;
  }
  const activeLayoutId = (dependencies.readLayoutPreference ?? readActiveLayoutPreference)(
    resources.projectId,
  );
  editorStore.getState().load(resources.project, activeLayoutId ?? undefined);
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
  ) => registerProjectFonts(projectFonts, resolveActiveProjectAssetUrl),
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
    ?? loadAllProjectImages;
  const registerFonts = dependencies.registerFonts
    ?? registerProjectFonts;
  const fetchStoreSpecs = dependencies.fetchStoreSpecs ?? (() => fetch("/api/store-specs"));

  const projectResponse = await fetchProject();
  if (!projectResponse.ok) throw await responseError(projectResponse, "Failed to load project");
  const revision = requireProjectRevision(projectResponse.headers.get("etag"));
  const projectId = projectResponse.headers.get("x-project-id")?.trim();
  if (!projectId) throw new Error("Project response is missing its project identifier");
  const project = parseProject(await projectResponse.json());
  const resolveAsset = createProjectAssetResolver({ projectId, revision });
  const images = await loadImages(project, resolveAsset);

  const fontWarnings = await loadProjectFontWarnings(
    project.fonts,
    (fonts) => registerFonts(fonts, resolveAsset),
  );

  const specsResponse = await fetchStoreSpecs();
  if (!specsResponse.ok) throw await responseError(specsResponse, "Failed to load store specs");
  const specs = parseStoreSpecs(await specsResponse.json());

  return { project, projectId, revision, images, specs, fontWarnings };
}

export function useEditorResources() {
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageCache | null>(null);
  const [specs, setSpecs] = useState<StoreSpecs | null>(null);
  const [fontWarnings, setFontWarnings] = useState<FontRegistrationFailure[]>([]);
  const [reloading, setReloading] = useState(false);
  const [fontRetrying, setFontRetrying] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const imagesRef = useRef<ImageCache | null>(null);
  const resourceGeneration = useRef(0);
  const fontGeneration = useRef(0);
  const projectId = useRef<string | null>(null);
  const assetSignature = useStore(editorStore, (state) =>
    state.project ? collectImageUrls(state.project).sort().join("\n") : "",
  );

  const startReload = useCallback(async (serialize: EditorResourceSerializer) => {
    const generation = ++resourceGeneration.current;
    ++fontGeneration.current;
    setError(null);
    imagesRef.current = null;
    setImages(null);
    setSpecs(null);
    setFontWarnings([]);
    setReloading(true);
    try {
      return await runEditorResourceReload({
        serialize,
        load: loadEditorResources,
        isCurrent: () => resourceGeneration.current === generation,
        apply: (resources) => {
          // A revision becomes globally usable only after every required resource validated and this
          // generation won. Cancelled or delayed fetches cannot roll the save coordinator backwards.
          applyEditorResourceResult(resources);
          projectId.current = resources.projectId;
          setActiveProjectId(resources.projectId);
          imagesRef.current = resources.images;
          setImages(resources.images);
          setSpecs(resources.specs);
          setFontWarnings(resources.fontWarnings);
        },
      });
    } catch (error: unknown) {
      if (resourceGeneration.current === generation) setError((error as Error).message);
      return false;
    } finally {
      if (resourceGeneration.current === generation) setReloading(false);
    }
  }, []);

  useEffect(() => editorStore.subscribe((state, previous) => {
    const currentProjectId = projectId.current;
    if (
      currentProjectId
      && state.activeLayoutId
      && state.activeLayoutId !== previous.activeLayoutId
    ) {
      writeActiveLayoutPreference(currentProjectId, state.activeLayoutId);
    }
  }), []);

  const cancelLoads = useCallback(() => {
    ++resourceGeneration.current;
    ++fontGeneration.current;
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void startReload(selectEditorResourceSerializer(editorStore.getState().project !== null));
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
    void loadAllProjectImages(project, resolveActiveProjectAssetUrl).then((loaded) => {
      if (cancelled) return;
      setImages((current) => {
        if (!current) {
          imagesRef.current = loaded;
          return loaded;
        }
        const next = new Map(current);
        let changed = false;
        for (const assetUrl of missing) {
          const image = loaded.get(assetUrl);
          if (image) {
            next.set(assetUrl, image);
            changed = true;
          }
        }
        const result = changed ? next : current;
        imagesRef.current = result;
        return result;
      });
    });
    return () => { cancelled = true; };
  }, [assetSignature, images]);

  const retry = useCallback(() => {
    if (reloading) return;
    const serialize = selectEditorResourceSerializer(editorStore.getState().project !== null);
    void startReload(serialize);
  }, [reloading, startReload]);

  const reload = useCallback(() => startReload(
    selectEditorResourceSerializer(editorStore.getState().project !== null),
  ), [startReload]);

  const cacheImage = useCallback(async (assetUrl: string): Promise<boolean> => {
    const generation = resourceGeneration.current;
    const current = imagesRef.current;
    if (!current) return false;
    if (current.has(assetUrl)) return true;
    const image = await loadProjectImage(assetUrl, resolveActiveProjectAssetUrl);
    if (!image
      || resourceGeneration.current !== generation
      || imagesRef.current !== current) return false;
    const next = cacheDecodedProjectImage(current, assetUrl, image);
    imagesRef.current = next;
    setImages(next);
    return true;
  }, []);

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
    reload,
    cacheImage,
    reloading,
    retryFonts,
    fontRetrying,
    activeProjectId,
  };
}
