// SPDX-License-Identifier: Apache-2.0
import type { ProjectScaffoldInput } from "@screenshot-studio/core/scaffold";

interface LauncherExampleBase {
  id: "isolated-project" | "connected-deck" | "rtl-multi-locale" | "imported-screenshots";
  title: string;
  description: string;
  actionLabel: string;
}

export type LauncherExampleWorkflow = LauncherExampleBase & (
  | {
    action: "create-project";
    creation: Pick<ProjectScaffoldInput, "platform" | "layoutMode" | "templateId">;
  }
  | { action: "project-import" }
  | { action: "capture-import" }
);

export const launcherExampleWorkflows: readonly LauncherExampleWorkflow[] = [
  {
    id: "isolated-project",
    title: "Isolated feature project",
    description: "Start with independent store images and a focused two-screen project template.",
    action: "create-project",
    actionLabel: "Create isolated example",
    creation: { platform: "apple", layoutMode: "isolated", templateId: "feature-focus" },
  },
  {
    id: "connected-deck",
    title: "Connected launch deck",
    description: "Build a continuous three-screen launch story that still exports exact store images.",
    action: "create-project",
    actionLabel: "Create connected example",
    creation: { platform: "apple", layoutMode: "connected", templateId: "product-launch" },
  },
  {
    id: "rtl-multi-locale",
    title: "RTL and multi-locale delivery",
    description: "Import a current-schema project with English and Arabic locale groups and RTL copy.",
    action: "project-import",
    actionLabel: "Import locale example",
  },
  {
    id: "imported-screenshots",
    title: "Imported screenshot story",
    description: "Preview a PNG capture folder, then publish it into an explicitly named managed project.",
    action: "capture-import",
    actionLabel: "Import screenshot example",
  },
] as const;
