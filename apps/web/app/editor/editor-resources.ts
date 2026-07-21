// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import {
  registerProjectFonts,
  type FontRegistrationFailure,
} from "@screenshot-studio/core/fonts";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore } from "@web/lib/editor-store";
import {
  readActiveLayoutPreference,
  writeActiveLayoutPreference,
} from "@web/lib/editor-layout-preference";
import {
  createProjectAssetResolver,
  getProjectPersistenceIdentity,
  requireProjectRevision,
  setProjectPersistenceIdentity,
  type ProjectAssetResolver,
} from "@web/lib/save-project";
import { withFlushedProject } from "@web/lib/debounced-save";
import {
  loadAllProjectImages,
  useEditorImageCache,
} from "@web/app/editor/use-editor-image-cache";
import {
  loadProjectFontWarnings,
  useEditorFontWarnings,
} from "@web/app/editor/use-editor-font-warnings";

export {
  cacheDecodedProjectImage,
  missingImageUrls,
} from "@web/app/editor/use-editor-image-cache";
export { loadProjectFontWarnings } from "@web/app/editor/use-editor-font-warnings";

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
  const [specs, setSpecs] = useState<StoreSpecs | null>(null);
  const [reloading, setReloading] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const resourceGeneration = useRef(0);
  const projectId = useRef<string | null>(null);
  const {
    images,
    reset: resetImages,
    replace: replaceImages,
    cacheImage,
  } = useEditorImageCache(resourceGeneration);
  const {
    fontWarnings,
    fontRetrying,
    reset: resetFontWarnings,
    cancel: cancelFontLoads,
    replace: replaceFontWarnings,
    retryFonts,
  } = useEditorFontWarnings(setError);

  const startReload = useCallback(async (serialize: EditorResourceSerializer) => {
    const generation = ++resourceGeneration.current;
    setError(null);
    resetImages();
    setSpecs(null);
    resetFontWarnings();
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
          replaceImages(resources.images);
          setSpecs(resources.specs);
          replaceFontWarnings(resources.fontWarnings);
        },
      });
    } catch (error: unknown) {
      if (resourceGeneration.current === generation) setError((error as Error).message);
      return false;
    } finally {
      if (resourceGeneration.current === generation) setReloading(false);
    }
  }, [replaceFontWarnings, replaceImages, resetFontWarnings, resetImages]);

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
    cancelFontLoads();
  }, [cancelFontLoads]);

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

  const retry = useCallback(() => {
    if (reloading) return;
    const serialize = selectEditorResourceSerializer(editorStore.getState().project !== null);
    void startReload(serialize);
  }, [reloading, startReload]);

  const reload = useCallback(() => startReload(
    selectEditorResourceSerializer(editorStore.getState().project !== null),
  ), [startReload]);

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
