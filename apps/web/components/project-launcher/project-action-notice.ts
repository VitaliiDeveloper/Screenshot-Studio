// SPDX-License-Identifier: Apache-2.0

export interface ProjectLibraryNotice {
  entryId: string;
  message: string;
  motion: "visible" | "closing";
}

export const projectActionNoticeVisibleMs = 2_400;
export const projectActionNoticeExitMs = 180;
// Launcher toasts carry a full sentence, so they stay readable longer than card notices.
export const projectToastVisibleMs = 5_000;
// Single source for card removal timing: the gallery applies these to the leaving card's animation
// and the neighbours' slide, and the launcher drops the entry once the exit finishes.
export const projectCardExitMs = 280;
export const projectCardSlideMs = 320;
export const projectCardSlideEasing = "cubic-bezier(0.2, 0, 0, 1)";

/** The card that should take focus when `removedId` leaves: the next one, else the previous. */
export function neighbourEntryId(
  entries: readonly { entryId: string }[],
  removedId: string,
): string | null {
  const index = entries.findIndex((entry) => entry.entryId === removedId);
  if (index < 0) return null;
  return entries[index + 1]?.entryId ?? entries[index - 1]?.entryId ?? null;
}

export class ProjectActionNoticeState {
  private visibleTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly publish: (notice: ProjectLibraryNotice | null) => void,
    private readonly visibleMs = projectActionNoticeVisibleMs,
  ) {}

  show(entryId: string, message: string): void {
    this.clearTimers();
    const notice = { entryId, message, motion: "visible" } as const;
    this.publish(notice);
    this.visibleTimer = setTimeout(() => {
      this.visibleTimer = null;
      this.publish({ ...notice, motion: "closing" });
      this.exitTimer = setTimeout(() => {
        this.exitTimer = null;
        this.publish(null);
      }, projectActionNoticeExitMs);
    }, this.visibleMs);
  }

  clear(): void {
    this.clearTimers();
    this.publish(null);
  }

  dispose(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.visibleTimer !== null) clearTimeout(this.visibleTimer);
    if (this.exitTimer !== null) clearTimeout(this.exitTimer);
    this.visibleTimer = null;
    this.exitTimer = null;
  }
}
