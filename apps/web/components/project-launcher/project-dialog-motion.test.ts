// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  LAUNCHER_DIALOG_EXIT_MS,
  launcherDialogExitDelay,
  requestLauncherDialogExit,
} from "@web/components/project-launcher/project-dialog-motion.js";

describe("project dialog motion", () => {
  it("keeps the first close intent and ignores closing during atomic publication", () => {
    expect(requestLauncherDialogExit(null, "close", false)).toBe("close");
    expect(requestLauncherDialogExit("close", "cancel", false)).toBe("close");
    expect(requestLauncherDialogExit(null, "cancel", true)).toBeNull();
  });

  it("uses a bounded exit delay and completes immediately for reduced motion", () => {
    expect(LAUNCHER_DIALOG_EXIT_MS).toBe(180);
    expect(launcherDialogExitDelay(false)).toBe(180);
    expect(launcherDialogExitDelay(true)).toBe(0);
  });
});
