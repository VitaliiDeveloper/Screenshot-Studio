// SPDX-License-Identifier: Apache-2.0

export const LAUNCHER_DIALOG_EXIT_MS = 180;

export type LauncherDialogExitAction = "close" | "cancel" | null;

export function launcherDialogExitDelay(reducedMotion: boolean): 0 | 180 {
  return reducedMotion ? 0 : LAUNCHER_DIALOG_EXIT_MS;
}

export function requestLauncherDialogExit(
  current: LauncherDialogExitAction,
  requested: Exclude<LauncherDialogExitAction, null>,
  publishing: boolean,
): LauncherDialogExitAction {
  if (publishing || current) return current;
  return requested;
}
